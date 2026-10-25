import { v } from "convex/values";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { carRepair, mayaInput } from "../lib/planner/fixtures/maya";
import type { PlannerInput } from "../lib/planner/types";
import { applyEvent, type FinanceEvent } from "../lib/agent/events";

async function log(ctx: MutationCtx, kind: "data" | "event" | "human", title: string, detail: string) {
  await ctx.db.insert("audit", { kind, title, detail });
}

/** Every change to the user's finances goes through the agent. */
async function startAgent(ctx: MutationCtx, trigger: string): Promise<Id<"agentRuns">> {
  const runId = await ctx.db.insert("agentRuns", { trigger, status: "running" });
  await ctx.db.insert("audit", { kind: "agent", title: "Agent triggered", detail: trigger, runId });
  await ctx.scheduler.runAfter(0, internal.agent.onEvent, { runId, trigger });
  return runId;
}

const profileArgs = {
  input: v.any(),
  profileName: v.string(),
  sources: v.object({ credit: v.string(), cash: v.string() }),
  creditScore: v.optional(v.number()),
  dataLog: v.array(v.object({ title: v.string(), detail: v.string() })),
};

/** Wipe the demo, store a new profile, then let the agent make the first plan. */
async function loadProfileImpl(
  ctx: MutationCtx,
  p: { input: PlannerInput; profileName: string; sources: { credit: string; cash: string }; creditScore?: number; dataLog: { title: string; detail: string }[] },
) {
  for (const table of ["profiles", "plans", "audit", "agentRuns", "questions", "backtests"] as const) {
    for (const row of await ctx.db.query(table).collect()) await ctx.db.delete(row._id);
  }
  // A fresh profile starts with every data feed healthy.
  const feed = await ctx.db.query("integrations").withIndex("by_name", (q) => q.eq("name", "crs_feed")).first();
  if (feed?.outageSince) await ctx.db.patch(feed._id, { outageSince: undefined });
  await ctx.db.insert("profiles", {
    input: p.input,
    updatedAt: Date.now(),
    profileName: p.profileName,
    sources: p.sources,
    creditSyncedAt: Date.now(),
    ...(p.creditScore !== undefined ? { creditScore: p.creditScore } : {}),
  });
  for (const entry of p.dataLog) await log(ctx, "data", entry.title, entry.detail);
  await startAgent(ctx, `Initial plan: ${p.profileName} loaded`);
}

/** Reload the Maya fixture. */
export const reset = mutation({
  args: {},
  handler: async (ctx) => {
    await loadProfileImpl(ctx, {
      input: mayaInput,
      profileName: "Maya R. · freelance designer + delivery driver",
      sources: { credit: "fixture (CRS shape)", cash: "fixture (Nessie shape)" },
      dataLog: [
        { title: "Credit profile loaded", detail: `${mayaInput.debts.length} tradelines · fixture (CRS shape)` },
        { title: "Cash history loaded", detail: `${mayaInput.historicalWeeklyIncome.length} weeks · fixture (Nessie shape)` },
      ],
    });
  },
});

/** Used by sponsor-data imports (crs.ts, nessie.ts) after they normalize a response. */
export const loadProfile = internalMutation({
  args: profileArgs,
  handler: async (ctx, p) => {
    await loadProfileImpl(ctx, { ...p, input: p.input as PlannerInput });
  },
});

/**
 * Inject a surprise expense that has already happened (week 0), paid from cash.
 * Expenses add up until reset, so a judge can stack "car repair, then a vet bill".
 */
export const simulateShock = mutation({
  args: { amount: v.number(), label: v.optional(v.string()) },
  handler: async (ctx, { amount, label }) => {
    if (!Number.isFinite(amount) || amount <= 0 || amount > 50_000) throw new Error("Amount must be between $1 and $50,000");
    const profile = await ctx.db.query("profiles").first();
    if (!profile) throw new Error("Run reset first");
    const input = profile.input as PlannerInput;
    const name = label?.trim().slice(0, 60) || carRepair.label;
    const prior = input.shock?.week === 0 ? input.shock : undefined;
    const shock = {
      ...carRepair,
      label: prior ? `${prior.label} + ${name}` : name,
      amount: Math.round((prior?.amount ?? 0) + amount),
    };
    await ctx.db.patch(profile._id, { input: { ...input, shock }, updatedAt: Date.now() });
    const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
    await log(ctx, "event", `Expense event: ${usd(amount)}`, `${name} · paid from cash${prior ? ` · ${usd(shock.amount)} in surprise expenses so far` : ""}`);
    await startAgent(ctx, `Expense event: ${name} ${usd(amount)}, paid from cash today${prior ? ` (total surprise expenses ${usd(shock.amount)})` : ""}`);
  },
});

export const decide = mutation({
  args: { planId: v.id("plans"), approve: v.boolean() },
  handler: async (ctx, { planId, approve }) => {
    const plan = await ctx.db.get(planId);
    if (!plan || plan.approval !== "pending") throw new Error("Nothing to approve");
    await ctx.db.patch(planId, { approval: approve ? "approved" : "declined" });
    const pay = plan.result?.recommended?.extraPayment ?? 0;
    await log(
      ctx,
      "human",
      approve ? "Approved by Maya" : "Declined by Maya",
      approve ? `Simulated payment $${pay.toLocaleString("en-US")} (no payment rail connected)` : "Previous plan kept",
    );
  },
});

export const ask = mutation({
  args: { question: v.string() },
  handler: async (ctx, { question }) => {
    const text = question.trim().slice(0, 500);
    if (!text) throw new Error("Empty question");
    const questionId = await ctx.db.insert("questions", { question: text, status: "thinking" });
    await ctx.scheduler.runAfter(0, internal.agent.answer, { questionId });
  },
});

/** Replace the cash side of the profile (balance + income history) and re-plan. */
export const updateCash = internalMutation({
  args: {
    cashBalance: v.number(),
    weeklyIncome: v.array(v.number()),
    cashSource: v.string(),
    detail: v.string(),
  },
  handler: async (ctx, { cashBalance, weeklyIncome, cashSource, detail }) => {
    const profile = await ctx.db.query("profiles").first();
    if (!profile) throw new Error("Load a profile first");
    const input = profile.input as PlannerInput;
    await ctx.db.patch(profile._id, {
      input: { ...input, cashBalance, historicalWeeklyIncome: weeklyIncome, shock: undefined },
      sources: { credit: profile.sources?.credit ?? "fixture (CRS shape)", cash: cashSource },
      updatedAt: Date.now(),
    });
    await log(ctx, "data", "Cash history loaded from Nessie", detail);
    await startAgent(ctx, `Cash data updated: ${cashSource}`);
  },
});

/** Apply an interpreted "What happened?" event and let the agent re-plan. */
export const applyFinanceEvent = internalMutation({
  args: { text: v.string(), event: v.any(), interpretedBy: v.union(v.literal("claude"), v.literal("rules")) },
  handler: async (ctx, { text, event, interpretedBy }): Promise<{ applied: boolean; summary: string }> => {
    const profile = await ctx.db.query("profiles").first();
    if (!profile) throw new Error("Load a profile first");
    const e = event as FinanceEvent;
    const result = applyEvent(profile.input as PlannerInput, e);
    const who = interpretedBy === "claude" ? "Claude" : "Rules parser";
    if (!result) {
      await log(ctx, "event", "Not a financial event", `"${text.slice(0, 120)}" · ${who}: ${e.explanation}`);
      return { applied: false, summary: e.explanation };
    }
    await ctx.db.patch(profile._id, { input: result.input, updatedAt: Date.now() });
    await log(ctx, "event", `What happened: ${result.summary}`, `"${text.slice(0, 120)}" · read by ${who}: ${e.explanation}`);
    await startAgent(ctx, `Event: ${result.summary}`);
    return { applied: true, summary: result.summary };
  },
});

/**
 * Demo: simulate the credit bureau feed going down (or coming back).
 * The agent is triggered either way and has to cope with what it finds.
 */
export const setCreditOutage = mutation({
  args: { down: v.boolean() },
  handler: async (ctx, { down }) => {
    const row = await ctx.db.query("integrations").withIndex("by_name", (q) => q.eq("name", "crs_feed")).first();
    const since = down ? Date.now() : undefined;
    if (row) await ctx.db.patch(row._id, { outageSince: since });
    else await ctx.db.insert("integrations", { name: "crs_feed", outageSince: since });
    if (down) {
      await log(ctx, "event", "Credit feed down (simulated)", "CRS requests now time out; last known credit snapshot is still stored");
      await startAgent(ctx, "Data event: the credit bureau feed (CRS) stopped responding");
    } else {
      await log(ctx, "event", "Credit feed restored (simulated)", "CRS is responding again");
      await startAgent(ctx, "Data event: the credit bureau feed (CRS) is responding again");
    }
  },
});
