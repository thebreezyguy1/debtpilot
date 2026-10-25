"use node";

// The DebtPilot agent. Claude orchestrates and explains; the planner engine
// does every calculation. Without ANTHROPIC_API_KEY (or if the API call fails)
// a rules-based agent runs the same tools so the demo never breaks.
import Anthropic from "@anthropic-ai/sdk";
import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  comparePlans,
  findPlan,
  summarizeComparison,
  summarizePlan,
  summarizeState,
  toolsFor,
  withExtraExpense,
  type AgentMode,
  type CreditFeed,
  type PreviousPlan,
} from "../lib/agent/tools";
import { availableCashToday } from "../lib/planner";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { FinanceEventSchema, interpreterPrompt, rulesInterpret, type FinanceEvent } from "../lib/agent/events";
import type { PlannerInput } from "../lib/planner/types";

const MODEL = "claude-opus-5-5";
const MAX_TURNS = 8;

const SYSTEM = `You are DebtPilot, a debt-planning agent for a freelance and gig worker whose income changes week to week. You help them pay down debt without making it likely they miss a required payment (rent or a debt minimum).

How you work:
- Every number you state must come from a tool result. Do not calculate balances, probabilities, interest or payment amounts yourself.
- simulate_plan finds the safe payment; compare_plan explains trade-offs between two payment amounts on the same simulated futures.
- You never move money. Payments only happen after the user approves.
- Past-due amounts are owed at the next due date. Debts in collections are outside the plan: mention them and suggest the user talk to a credit counselor about negotiating them; never suggest extra payments to them.
- Data is synthetic demo data; say so if asked whether it is real.
- Write plain text in short sentences for a non-expert: no markdown, asterisks, headings or lists.`;

const EVENT_INSTRUCTIONS = `Something changed in the user's finances (the trigger is below). Bring their plan up to date: look at the state, re-run the planner, and compare the new recommendation with the previous plan (or with paying all available cash if there is no previous plan). If the recommended payment differs from the previous plan, call request_approval with a short message for the user. When a data source has just come back, call refresh_credit_data before planning. If get_financial_state shows a data source as unavailable, call refresh_credit_data once; if it still fails, carry on with the last known data (the planner then caps payments at the previous plan) and say plainly what was unavailable and what you did. Finish with two or three sentences explaining what you decided and why; this goes into the audit log.`;

type ToolCtx = {
  ctx: ActionCtx;
  mode: AgentMode;
  input: PlannerInput;
  previous: PreviousPlan;
  creditFeed: CreditFeed;
  runId?: Id<"agentRuns">;
  toolsUsed: string[];
};

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (p: number) => `${(p * 100).toFixed(1)}%`;

/** The log and answers render as plain text; drop stray markdown emphasis and headings. */
function stripMarkdown(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/^\s*[-*]\s+/gm, "").trim();
}

function num(x: unknown, fallback = 0): number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : fallback;
}

async function audit(t: ToolCtx, kind: "tool" | "agent" | "planner", title: string, detail: string) {
  if (t.mode !== "event") return; // questions are recorded on the question itself
  await t.ctx.runMutation(internal.agentData.log, { kind, title, detail, runId: t.runId });
}

/** Execute one tool call. Returns the JSON string handed back to the model. */
async function executeTool(t: ToolCtx, name: string, args: Record<string, unknown>, actor: string): Promise<string> {
  t.toolsUsed.push(name);
  switch (name) {
    case "get_financial_state": {
      await audit(t, "tool", `${actor} called get_financial_state`, `${t.input.debts.length} debts · cash ${usd(t.input.cashBalance)}`);
      return JSON.stringify(summarizeState(t.input, t.previous, t.creditFeed));
    }
    case "simulate_plan": {
      const extra = t.mode === "event" ? 0 : num(args.extra_expense);
      // Safe mode while credit data is stale: never recommend more than the previous plan.
      const cap = t.creditFeed.down ? (t.previous?.payment ?? 0) : undefined;
      const input = { ...withExtraExpense(t.input, extra), ...(cap !== undefined ? { maxExtraPayment: cap } : {}) };
      const result = findPlan(input);
      const notes =
        cap !== undefined
          ? [`Credit data unavailable: using the last known snapshot, payments capped at the previous plan (${usd(cap)})`]
          : [];
      const rec = result.recommended;
      if (t.mode === "event" && t.runId) {
        const baseline = t.previous?.payment ?? availableCashToday(input);
        const comparison = comparePlans(input, rec.extraPayment, baseline);
        const comparisonLabel = t.previous ? "Keep the previous plan" : "Pay all available cash";
        await t.ctx.runMutation(internal.agentData.savePlan, { runId: t.runId, result, comparison, comparisonLabel, notes });
      }
      await audit(
        t,
        "tool",
        `${actor} called simulate_plan`,
        `${result.scenarios.toLocaleString("en-US")} paths → ${usd(rec.extraPayment)} safe · miss risk ${pct(rec.missProbability)}` +
          (result.status === "no-safe-plan" ? " · no payment meets the limit" : "") +
          (cap !== undefined ? ` · safe mode: capped at ${usd(cap)}` : ""),
      );
      return JSON.stringify({ ...summarizePlan(input, result), ...(notes.length ? { caveats: notes } : {}) });
    }
    case "refresh_credit_data": {
      if (t.creditFeed.down) {
        await audit(t, "tool", `${actor} called refresh_credit_data: failed`, "CRS timed out after 10 s (simulated outage)");
        return JSON.stringify({
          ok: false,
          error: "Credit bureau request timed out after 10 seconds.",
          last_known_snapshot: summarizeState(t.input, t.previous, t.creditFeed).data_health.credit_last_synced,
        });
      }
      await t.ctx.runMutation(internal.agentData.markCreditSynced, {});
      t.creditFeed = { ...t.creditFeed, lastSyncedAt: Date.now() };
      await audit(t, "tool", `${actor} called refresh_credit_data`, "Credit bureau responding; snapshot confirmed current");
      return JSON.stringify({ ok: true, synced: "just now" });
    }
    case "compare_plan": {
      const a = num(args.payment_a);
      const b = num(args.payment_b);
      const input = withExtraExpense(t.input, t.mode === "event" ? 0 : num(args.extra_expense));
      const c = comparePlans(input, a, b);
      await audit(
        t,
        "tool",
        `${actor} called compare_plan`,
        `${usd(a)} vs ${usd(b)}: miss risk ${pct(c.a.missProbability)} vs ${pct(c.b.missProbability)}, cost ${usd(c.a.expectedCost)} vs ${usd(c.b.expectedCost)}`,
      );
      return JSON.stringify(summarizeComparison(input, c));
    }
    case "request_approval": {
      if (t.mode !== "event" || !t.runId) return JSON.stringify({ ok: false, error: "Not available when answering questions." });
      const message = typeof args.message === "string" ? args.message.slice(0, 600) : "";
      if (!message) return JSON.stringify({ ok: false, error: "message is required" });
      const res = await t.ctx.runMutation(internal.agentData.requestApproval, { runId: t.runId, message });
      if (res.ok) await audit(t, "agent", "Approval requested", message);
      return JSON.stringify(res);
    }
    default:
      return JSON.stringify({ ok: false, error: `Unknown tool ${name}` });
  }
}

function hasCredentials() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/** Manual tool loop: we execute each call ourselves so every step lands in the audit log. */
async function runClaude(t: ToolCtx, userText: string): Promise<string> {
  const client = new Anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: userText }];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: SYSTEM,
      tools: toolsFor(t.mode),
      messages,
    });

    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (response.stop_reason === "refusal") {
      return text || "I can't help with that request.";
    }
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) return text;

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const args = (use.input ?? {}) as Record<string, unknown>;
      results.push({ type: "tool_result", tool_use_id: use.id, content: await executeTool(t, use.name, args, "Claude") });
    }
    messages.push({ role: "user", content: results });
  }
  return "I ran out of steps before finishing; the latest simulation is shown on the dashboard.";
}

/** Deterministic agent: same tools, fixed order, templated explanation. */
async function runRulesEvent(t: ToolCtx, trigger: string): Promise<string> {
  await executeTool(t, "get_financial_state", {}, "Rules agent");
  if (t.creditFeed.down || /credit bureau feed/.test(trigger)) {
    await executeTool(t, "refresh_credit_data", {}, "Rules agent");
  }
  const plan = JSON.parse(await executeTool(t, "simulate_plan", { extra_expense: 0 }, "Rules agent"));
  const rec = plan.recommended;
  const baseline = t.previous?.payment ?? availableCashToday(t.input);
  const cmp = JSON.parse(
    await executeTool(t, "compare_plan", { payment_a: rec.extra_payment, payment_b: baseline, extra_expense: 0 }, "Rules agent"),
  );
  const changed = t.previous !== null && t.previous.payment !== rec.extra_payment;
  if (changed) {
    const message =
      plan.status === "no-safe-plan"
        ? `Pause the ${usd(t.previous!.payment)} extra payment and hold cash: even paying nothing extra leaves a ${rec.miss_probability_pct}% chance of missing a payment.`
        : `Pay ${usd(rec.extra_payment)} instead of ${usd(t.previous!.payment)}. Keeping the old amount would raise your chance of missing a payment to ${cmp.b.miss_probability_pct}%.`;
    await executeTool(t, "request_approval", { message }, "Rules agent");
  }
  const staleNote = t.creditFeed.down
    ? " Credit data is unavailable, so this plan uses the last known snapshot and won't pay more than the previous plan."
    : "";
  return (plan.status === "no-safe-plan"
    ? `No extra payment fits the ${pct(t.input.riskTolerance)} risk limit, so the plan holds cash. Compared with ${usd(baseline)}, holding avoids ${usd(cmp.b_minus_a.expected_total_cost)} of expected cost.`
    : `Safe extra payment is ${usd(rec.extra_payment)} (miss risk ${rec.miss_probability_pct}%). Paying ${usd(baseline)} instead would change expected cost by ${usd(cmp.b_minus_a.expected_total_cost)} and miss risk by ${cmp.b_minus_a.miss_probability_pct} points.`) + staleNote;
}

async function runRulesAnswer(t: ToolCtx, question: string): Promise<string> {
  const plan = JSON.parse(await executeTool(t, "simulate_plan", { extra_expense: 0 }, "Rules agent"));
  const rec = plan.recommended;
  const amount = question.match(/\$\s?([\d,]+)/);
  const alt = amount ? Number(amount[1]!.replace(/,/g, "")) : availableCashToday(t.input);
  const cmp = JSON.parse(
    await executeTool(t, "compare_plan", { payment_a: rec.extra_payment, payment_b: alt, extra_expense: 0 }, "Rules agent"),
  );
  return (
    `The planner recommends ${usd(rec.extra_payment)} extra right now, with a ${rec.miss_probability_pct}% chance of missing a payment. ` +
    `Paying ${usd(alt)} instead gives a ${cmp.b.miss_probability_pct}% chance and an expected cost ${cmp.b_minus_a.expected_total_cost >= 0 ? "higher" : "lower"} by ${usd(Math.abs(cmp.b_minus_a.expected_total_cost))}. ` +
    `(Rules-based answer: connect Claude for free-form questions.)`
  );
}

async function loadState(ctx: ActionCtx, runId?: Id<"agentRuns">) {
  const { input, previous, creditFeed } = await ctx.runQuery(internal.agentData.state, { runId });
  if (!input) throw new Error("No profile loaded");
  return { input, previous, creditFeed };
}

export const onEvent = internalAction({
  args: { runId: v.id("agentRuns"), trigger: v.string() },
  handler: async (ctx, { runId, trigger }) => {
    const { input, previous, creditFeed } = await loadState(ctx, runId);
    const t: ToolCtx = { ctx, mode: "event", input, previous, creditFeed, runId, toolsUsed: [] };
    let mode: "claude" | "rules" = hasCredentials() ? "claude" : "rules";
    let summary: string;

    if (mode === "claude") {
      try {
        summary = await runClaude(t, `${EVENT_INSTRUCTIONS}\n\nTrigger: ${trigger}`);
      } catch (err) {
        const reason = err instanceof Anthropic.APIError ? `API error ${err.status}` : "unexpected error";
        await audit(t, "agent", "Claude unavailable, using rules agent", reason);
        mode = "rules";
        summary = await runRulesEvent(t, trigger);
      }
    } else {
      await audit(t, "agent", "Rules agent running", "No ANTHROPIC_API_KEY set on the Convex deployment");
      summary = await runRulesEvent(t, trigger);
    }

    // Guardrails enforced in code, whatever the model did.
    if (!t.creditFeed.down && /responding again/.test(trigger) && !t.toolsUsed.includes("refresh_credit_data")) {
      await executeTool(t, "refresh_credit_data", {}, "Guardrail");
    }
    let plan = await ctx.runQuery(internal.agentData.planForRun, { runId });
    if (!plan) {
      await executeTool(t, "simulate_plan", { extra_expense: 0 }, "Guardrail");
      plan = await ctx.runQuery(internal.agentData.planForRun, { runId });
    }
    const payment = plan ? (plan.result.recommended.extraPayment as number) : undefined;
    if (plan && previous && payment !== previous.payment && plan.approval !== "pending") {
      const message = `Pay ${usd(payment!)} instead of ${usd(previous.payment)}. This changes your previous plan, so it needs your OK.`;
      await ctx.runMutation(internal.agentData.requestApproval, { runId, message });
      await audit(t, "agent", "Guardrail: approval required", "Plan changed without an approval request");
    }

    const plainSummary = stripMarkdown(summary);
    await audit(t, "agent", mode === "claude" ? "Claude's reasoning" : "Rules agent summary", plainSummary || "(no explanation returned)");
    await ctx.runMutation(internal.agentData.finishRun, { runId, status: "done", mode, summary: plainSummary });
  },
});

export const answer = internalAction({
  args: { questionId: v.id("questions") },
  handler: async (ctx, { questionId }) => {
    const q = await ctx.runQuery(internal.agentData.getQuestion, { questionId });
    if (!q) return;
    const { input, previous, creditFeed } = await loadState(ctx);
    const t: ToolCtx = { ctx, mode: "ask", input, previous, creditFeed, toolsUsed: [] };
    let mode: "claude" | "rules" = hasCredentials() ? "claude" : "rules";
    let answerText: string;
    try {
      answerText = mode === "claude" ? await runClaude(t, q.question) : await runRulesAnswer(t, q.question);
    } catch (err) {
      mode = "rules";
      answerText = await runRulesAnswer(t, q.question);
    }
    await ctx.runMutation(internal.agentData.answerQuestion, {
      questionId,
      status: "answered",
      answer: stripMarkdown(answerText) || "(no answer)",
      mode,
      toolsUsed: t.toolsUsed,
    });
  },
});

/** "What happened?" box: free text → typed event (Claude, else rules) → applied and re-planned. */
export const interpretEvent = action({
  args: { text: v.string() },
  handler: async (ctx, { text }): Promise<{ applied: boolean; summary: string; interpretedBy: "claude" | "rules" }> => {
    const clean = text.trim().slice(0, 300);
    if (!clean) throw new Error("Describe what happened");
    const { input } = await loadState(ctx);
    let event: FinanceEvent | null = null;
    let interpretedBy: "claude" | "rules" = "rules";
    if (hasCredentials()) {
      try {
        const response = await new Anthropic().beta.messages.parse({
          model: MODEL,
          max_tokens: 4000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "low", format: betaZodOutputFormat(FinanceEventSchema) },
          system: interpreterPrompt(input),
          messages: [{ role: "user", content: clean }],
        });
        if (response.stop_reason !== "refusal" && response.parsed_output) {
          event = response.parsed_output;
          interpretedBy = "claude";
        }
      } catch {
        // Fall through to the rules parser; the audit log records which one read the event.
      }
    }
    event ??= rulesInterpret(clean, input);
    const result = await ctx.runMutation(internal.demo.applyFinanceEvent, { text: clean, event, interpretedBy });
    return { ...result, interpretedBy };
  },
});
