// Backtest: run whole repayment strategies through the same simulated months
// of income and compare how often each one misses a required payment and what
// it costs. Uses the same weekly rules as the planner (simulate.ts stepWeek).
import { allocateByHighestApr, findPlan } from "./plan";
import { generateIncomePaths, percentile } from "./random";
import { applyShock, effectiveApr, newPathState, payExtra, penaltyTail, stepWeek, type DueRule, type PathState } from "./simulate";
import type { PlannerInput } from "./types";

export type Policy = { id: string; kind: "debtpilot" | "avalanche" | "minimums"; buffer?: number; label: string; description: string };

export type BacktestOptions = {
  weeks: number;
  futures: number;
  /** Strategies decide how much extra to pay every this many weeks. */
  decisionEvery: number;
  /** Usual advice: keep this much cash, send the rest to the highest-APR debt. One strategy per buffer. */
  avalancheBuffers: number[];
  /** DebtPilot's planner settings inside the backtest (smaller, for speed). */
  innerScenarios: number;
  innerStep: number;
  seed: number;
};

export const DEFAULT_BACKTEST: BacktestOptions = {
  weeks: 26,
  decisionEvery: 4,
  avalancheBuffers: [500, 1000, 1500],
  futures: 200,
  innerScenarios: 150,
  innerStep: 100,
  seed: 7,
};

export type PolicyResult = {
  id: string;
  kind: Policy["kind"];
  label: string;
  description: string;
  /** Share of futures with at least one missed required payment. */
  missProbability: number;
  avgMisses: number;
  expectedInterest: number;
  expectedFees: number;
  expectedPenaltyTail: number;
  expectedCost: number;
  meanEndingDebt: number;
  meanDebtPaidDown: number;
  p10EndingCash: number;
  meanDebtByWeek: number[];
};

export type BacktestResult = {
  options: BacktestOptions;
  startingDebt: number;
  policies: PolicyResult[];
};

/** Bills and minimums repeat on a 4-week cycle from the weeks the profile lists. */
const monthlyCycle: DueRule = (weeks, week) =>
  weeks === "weekly" || weeks.some((d) => week >= d && (week - d) % 4 === 0);

const totalDebt = (s: PathState) => s.debts.reduce((sum, d) => sum + d.balance, 0);

/** The planner's view from week `w`: current balances, and schedules re-based so week w is week 1. */
export function plannerInputAt(input: PlannerInput, state: PathState, w: number, opts: BacktestOptions): PlannerInput {
  const horizon = input.horizonWeeks;
  const rel = (weeks: number[]) =>
    Array.from({ length: horizon }, (_, i) => i + 1).filter((r) => monthlyCycle(weeks, w + r - 1));
  return {
    ...input,
    cashBalance: state.cash,
    shock: undefined,
    debts: state.debts
      .filter((d) => d.balance > 0.5)
      .map((d) => ({ ...d.debt, balance: d.balance, apr: effectiveApr(d, input), dueWeeks: rel(d.debt.dueWeeks) })),
    expenses: input.expenses.map((e) => ({ ...e, weeks: e.weeks === "weekly" ? "weekly" : rel(e.weeks) })),
    incomeChanges: (input.incomeChanges ?? [])
      .map((c) => ({ ...c, fromWeek: c.fromWeek - (w - 1) }))
      .map((c) => (c.fromWeek < 1 ? { ...c, weeks: c.weeks + c.fromWeek - 1, fromWeek: 1 } : c))
      .filter((c) => c.weeks > 0),
    scenarioCount: opts.innerScenarios,
    paymentStep: opts.innerStep,
    seed: input.seed + w,
  };
}

function decide(policy: Policy, input: PlannerInput, state: PathState, w: number, opts: BacktestOptions) {
  if (policy.kind === "minimums") return {};
  const debts = state.debts.filter((d) => d.balance > 0.5).map((d) => ({ ...d.debt, balance: d.balance }));
  if (policy.kind === "avalanche") return allocateByHighestApr(debts, Math.max(0, state.cash - (policy.buffer ?? 0)));
  return findPlan(plannerInputAt(input, state, w, opts)).recommended.allocation;
}

export function policiesFor(opts: BacktestOptions): Policy[] {
  const usd = (n: number) => `$${n.toLocaleString("en-US")}`;
  return [
    { id: "debtpilot", kind: "debtpilot", label: "DebtPilot", description: `Re-plans every ${opts.decisionEvery} weeks: lowest expected cost within the risk limit` },
    ...opts.avalancheBuffers.map((b): Policy => ({
      id: `avalanche-${b}`,
      kind: "avalanche",
      buffer: b,
      label: `Keep ${usd(b)}, rest to top APR`,
      description: `Usual advice: keep ${usd(b)} in cash, send the rest to the highest-APR debt every ${opts.decisionEvery} weeks`,
    })),
    { id: "minimums", kind: "minimums", label: "Minimums only", description: "Pay only the required minimums" },
  ];
}

export function runBacktest(input: PlannerInput, options: Partial<BacktestOptions> = {}): BacktestResult {
  const opts = { ...DEFAULT_BACKTEST, ...options };
  // One set of income futures shared by every strategy, so differences come from the strategy alone.
  const futures = generateIncomePaths(input.historicalWeeklyIncome, opts.weeks, opts.futures, input.blockLength, opts.seed);
  const startingDebt = input.debts.reduce((s, d) => s + d.balance, 0);

  const policies = policiesFor(opts).map((policy): PolicyResult => {
    const debtSums = new Array<number>(opts.weeks + 1).fill(0);
    const rows = futures.map((income) => {
      const state = newPathState(input);
      applyShock(state, input.shock, 0, input);
      debtSums[0]! += totalDebt(state);
      for (let w = 1; w <= opts.weeks; w++) {
        if ((w - 1) % opts.decisionEvery === 0) payExtra(state, decide(policy, input, state, w, opts));
        stepWeek(state, input, w, income[w - 1] ?? 0, monthlyCycle);
        debtSums[w]! += totalDebt(state);
      }
      return { state, tail: penaltyTail(state, input) };
    });

    const n = rows.length;
    const mean = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0) / n;
    const endingDebt = mean((r) => totalDebt(r.state));
    const interest = mean((r) => r.state.interest);
    const fees = mean((r) => r.state.fees);
    const tail = mean((r) => r.tail);
    return {
      id: policy.id,
      kind: policy.kind,
      label: policy.label,
      description: policy.description,
      missProbability: rows.filter((r) => r.state.missed).length / n,
      avgMisses: mean((r) => r.state.misses),
      expectedInterest: interest,
      expectedFees: fees,
      expectedPenaltyTail: tail,
      expectedCost: interest + fees + tail,
      meanEndingDebt: endingDebt,
      meanDebtPaidDown: startingDebt - endingDebt,
      p10EndingCash: percentile(rows.map((r) => r.state.cash).sort((a, b) => a - b), 0.1),
      meanDebtByWeek: debtSums.map((x) => x / n),
    };
  });

  return { options: opts, startingDebt, policies };
}
