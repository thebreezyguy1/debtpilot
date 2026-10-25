// The agent's tool surface. Every number the agent reports comes from these
// functions (the planner engine), never from the model's own arithmetic.
import type Anthropic from "@anthropic-ai/sdk";
import { availableCashToday, comparePlans, findPlan } from "../planner";
import type { CandidateResult, Comparison, PlannerInput, PlannerResult } from "../planner/types";

export type AgentMode = "event" | "ask";

export type PreviousPlan = { payment: number; approval: string; trigger: string } | null;

export type CreditFeed = { down: boolean; downSince: number | null; lastSyncedAt: number | null };

const money = (n: number) => Math.round(n);
const prob = (p: number) => Math.round(p * 1000) / 10; // percent, one decimal

const noArgs = { type: "object" as const, properties: {}, required: [], additionalProperties: false };

const extraExpense = {
  type: "number",
  description:
    "Hypothetical additional one-time expense today, in dollars, on top of the current state. Use 0 for the real current state.",
};

export const TOOLS: Record<string, Anthropic.Beta.BetaTool> = {
  get_financial_state: {
    name: "get_financial_state",
    description:
      "Return the user's normalized financial state: cash, debts (with which fields came from CRS vs. manual input), weekly income history, scheduled expenses, any surprise expense, the risk policy, and the previous plan.",
    strict: true,
    input_schema: noArgs,
  },
  simulate_plan: {
    name: "simulate_plan",
    description:
      "Run the Monte Carlo planner: simulates thousands of income futures and returns the lowest-expected-cost extra debt payment that keeps the chance of missing any required payment within the risk policy, or status no-safe-plan if none does. In an event run, extra_expense must be 0 and the result becomes the proposed plan.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { extra_expense: extraExpense },
      required: ["extra_expense"],
      additionalProperties: false,
    },
  },
  compare_plan: {
    name: "compare_plan",
    description:
      "Score two extra-payment amounts on the identical simulated income futures. Returns miss probability, expected interest, fees, penalty-APR cost and total expected cost for each, and the differences (b minus a).",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        payment_a: { type: "number", description: "First extra payment in dollars (usually the recommended one)." },
        payment_b: { type: "number", description: "Second extra payment in dollars (the alternative)." },
        extra_expense: extraExpense,
      },
      required: ["payment_a", "payment_b", "extra_expense"],
      additionalProperties: false,
    },
  },
  refresh_credit_data: {
    name: "refresh_credit_data",
    description:
      "Try to fetch fresh credit data (balances, limits, minimums) from the credit bureau (CRS). Returns ok, or an error if the bureau is unreachable. Call it when get_financial_state shows credit data as unavailable or stale.",
    strict: true,
    input_schema: noArgs,
  },
  request_approval: {
    name: "request_approval",
    description:
      "Ask the user to approve the proposed plan before it replaces their previous one. Required whenever the recommended payment differs from the previous plan. The message is shown to the user as-is.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "One or two plain sentences for the user: what changes and why, using numbers from the tools.",
        },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
};

export function toolsFor(mode: AgentMode): Anthropic.Beta.BetaTool[] {
  const names = mode === "event" ? Object.keys(TOOLS) : ["get_financial_state", "simulate_plan", "compare_plan"];
  // Order is fixed so the tool list (and the prompt cache) stays stable.
  return names.map((n) => TOOLS[n]!);
}

function debtLabel(input: PlannerInput, id: string) {
  return input.debts.find((d) => d.id === id)?.label ?? id;
}

export function summarizeCandidate(input: PlannerInput, c: CandidateResult) {
  return {
    extra_payment: money(c.extraPayment),
    goes_to: Object.entries(c.allocation).map(([id, amt]) => ({ debt: debtLabel(input, id), amount: money(amt) })),
    miss_probability_pct: prob(c.missProbability),
    miss_probability_margin_pct: prob(c.missStdError),
    expected_interest: money(c.expectedInterest),
    expected_late_fees: money(c.expectedFees),
    expected_penalty_apr_cost: money(c.expectedPenaltyTail),
    expected_total_cost: money(c.expectedCost),
    within_risk_policy: c.feasible,
  };
}

function ago(ms: number | null, now: number): string | null {
  if (!ms) return null;
  const min = Math.max(0, Math.round((now - ms) / 60000));
  return min < 1 ? "just now" : `${min} min ago`;
}

export function summarizeState(input: PlannerInput, previous: PreviousPlan, feed?: CreditFeed, now = Date.now()) {
  return {
    data_health: {
      credit_data: feed?.down ? "unavailable" : "ok",
      credit_last_synced: ago(feed?.lastSyncedAt ?? null, now),
      ...(feed?.down
        ? { note: "The credit bureau is not responding. Debts below are the last known snapshot. While this lasts, the planner will not recommend more than the previous plan." }
        : {}),
    },
    data_note: "Synthetic demo data shaped like the CRS (credit) and Nessie (cash) sandboxes.",
    cash_balance: money(input.cashBalance),
    cash_available_for_debt_today: money(availableCashToday(input)),
    surprise_expense: input.shock
      ? { label: input.shock.label, amount: money(input.shock.amount), already_paid_from: input.shock.payWith }
      : null,
    debts: input.debts.map((d) => ({
      label: d.label,
      kind: d.kind,
      balance: money(d.balance),
      apr_pct: Math.round(d.apr * 1000) / 10,
      minimum_payment: money(d.minimumPayment),
      due_weeks: d.dueWeeks,
      credit_limit: d.creditLimit ?? null,
      past_due: d.pastDue ?? 0,
      payment_status: d.status ?? "unknown",
      field_sources: d.sources,
    })),
    collections_not_in_plan: (input.collections ?? []).map((c) => ({ label: c.label, balance: money(c.balance) })),
    weekly_income_history: input.historicalWeeklyIncome,
    income_sources: input.incomeSources ?? [],
    upcoming_income_changes: (input.incomeChanges ?? []).map((c) => ({
      label: c.label,
      from_week: c.fromWeek,
      weeks: c.weeks,
      income_multiplier: c.multiplier,
    })),
    scheduled_expenses: input.expenses,
    risk_policy: { max_miss_probability_pct: prob(input.riskTolerance), horizon_weeks: input.horizonWeeks },
    fees: input.fees,
    previous_plan: previous
      ? { extra_payment: money(previous.payment), approval: previous.approval, made_after: previous.trigger }
      : null,
  };
}

export function withExtraExpense(input: PlannerInput, extra: number): PlannerInput {
  if (!(extra > 0)) return input;
  const base = input.shock?.week === 0 ? input.shock.amount : 0;
  return { ...input, shock: { label: "Hypothetical expense", amount: base + extra, week: 0, payWith: "cash" } };
}

export function summarizePlan(input: PlannerInput, r: PlannerResult) {
  return {
    status: r.status,
    scenarios: r.scenarios,
    recommended: summarizeCandidate(input, r.recommended),
    // A few points of the risk/cost frontier so the agent can reason about alternatives.
    frontier_sample: r.frontier
      .filter((_, i, all) => i % Math.max(1, Math.floor(all.length / 8)) === 0)
      .map((c) => ({
        extra_payment: money(c.extraPayment),
        miss_probability_pct: prob(c.missProbability),
        expected_total_cost: money(c.expectedCost),
      })),
  };
}

export function summarizeComparison(input: PlannerInput, c: Comparison) {
  return {
    a: summarizeCandidate(input, c.a),
    b: summarizeCandidate(input, c.b),
    b_minus_a: {
      expected_total_cost: money(c.deltaExpectedCost),
      expected_interest: money(c.deltaExpectedInterest),
      miss_probability_pct: prob(c.deltaMissProbability),
    },
  };
}

export { comparePlans, findPlan };
