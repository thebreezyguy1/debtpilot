// Database side of the agent. agent.ts runs in Node and reaches the
// database only through these internal functions.
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { agentMode, auditKind } from "./schema";
import type { PlannerInput, PlannerResult } from "../lib/planner/types";

export const state = internalQuery({
  args: { runId: v.optional(v.id("agentRuns")) },
  handler: async (ctx, { runId }) => {
    const profile = await ctx.db.query("profiles").first();
    // The plan before this run: what a new recommendation is compared against.
    const plans = await ctx.db.query("plans").order("desc").take(5);
    const previous = plans.find((p) => p.runId !== runId);
    const feed = await ctx.db.query("integrations").withIndex("by_name", (q) => q.eq("name", "crs_feed")).first();
    return {
      creditFeed: {
        down: Boolean(feed?.outageSince),
        downSince: feed?.outageSince ?? null,
        lastSyncedAt: profile?.creditSyncedAt ?? profile?.updatedAt ?? null,
      },
      input: (profile?.input ?? null) as PlannerInput | null,
      previous: previous
        ? {
            payment: (previous.result as PlannerResult).recommended.extraPayment,
            approval: previous.approval,
            trigger: previous.trigger,
          }
        : null,
    };
  },
});

export const log = internalMutation({
  args: { kind: auditKind, title: v.string(), detail: v.string(), runId: v.optional(v.id("agentRuns")) },
  handler: async (ctx, entry) => {
    await ctx.db.insert("audit", entry);
  },
});

/** Store (or replace) the plan this run proposes. */
export const savePlan = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    result: v.any(),
    comparison: v.optional(v.any()),
    comparisonLabel: v.optional(v.string()),
    notes: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { runId, result, comparison, comparisonLabel, notes }) => {
    const run = await ctx.db.get(runId);
    if (!run) throw new Error("Unknown run");
    const r = result as PlannerResult;
    const existing = await ctx.db
      .query("plans")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .first();
    const fields = { status: r.status, result: r, notes: notes ?? [], ...(comparison ? { comparison, comparisonLabel } : {}) };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("plans", { runId, trigger: run.trigger, approval: "none", ...fields });
    }
  },
});

export const requestApproval = internalMutation({
  args: { runId: v.id("agentRuns"), message: v.string() },
  handler: async (ctx, { runId, message }) => {
    const plan = await ctx.db
      .query("plans")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .first();
    if (!plan) return { ok: false, error: "No plan simulated in this run yet; call simulate_plan first." };
    await ctx.db.patch(plan._id, { approval: "pending", approvalMessage: message });
    return { ok: true };
  },
});

export const planForRun = internalQuery({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, { runId }) =>
    await ctx.db
      .query("plans")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .first(),
});

export const finishRun = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    status: v.union(v.literal("done"), v.literal("error")),
    mode: agentMode,
    summary: v.string(),
  },
  handler: async (ctx, { runId, ...fields }) => {
    await ctx.db.patch(runId, fields);
  },
});

export const getQuestion = internalQuery({
  args: { questionId: v.id("questions") },
  handler: async (ctx, { questionId }) => await ctx.db.get(questionId),
});

export const answerQuestion = internalMutation({
  args: {
    questionId: v.id("questions"),
    status: v.union(v.literal("answered"), v.literal("error")),
    answer: v.string(),
    mode: agentMode,
    toolsUsed: v.array(v.string()),
  },
  handler: async (ctx, { questionId, ...fields }) => {
    await ctx.db.patch(questionId, fields);
  },
});

/** A successful credit refresh: the stored snapshot is current again. */
export const markCreditSynced = internalMutation({
  args: {},
  handler: async (ctx) => {
    const profile = await ctx.db.query("profiles").first();
    if (profile) await ctx.db.patch(profile._id, { creditSyncedAt: Date.now() });
  },
});
