import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const auditKind = v.union(
  v.literal("data"),
  v.literal("event"),
  v.literal("planner"),
  v.literal("agent"),
  v.literal("tool"),
  v.literal("human"),
);

export const agentMode = v.union(v.literal("claude"), v.literal("rules"));

export default defineSchema({
  // Normalized PlannerInput (lib/planner/types.ts). One row per demo user.
  profiles: defineTable({
    input: v.any(),
    updatedAt: v.number(),
    profileName: v.optional(v.string()),
    // Where each part of the input came from, shown in the header chips.
    sources: v.optional(v.object({ credit: v.string(), cash: v.string() })),
    creditScore: v.optional(v.number()),
    // Last time credit data was fetched successfully (the "last known good" snapshot).
    creditSyncedAt: v.optional(v.number()),
  }),

  // Sponsor API state. A failed CRS login locks further attempts, because
  // repeated failed logins disable the sandbox account.
  integrations: defineTable({
    name: v.string(),
    lockedReason: v.optional(v.string()),
    accountId: v.optional(v.string()), // Nessie: the demo account to read cash history from
    outageSince: v.optional(v.number()), // demo only: a simulated outage of this source
  }).index("by_name", ["name"]),

  // One agent run per event (initial load, expense, ...).
  agentRuns: defineTable({
    trigger: v.string(),
    status: v.union(v.literal("running"), v.literal("done"), v.literal("error")),
    mode: v.optional(agentMode),
    summary: v.optional(v.string()),
  }),

  plans: defineTable({
    runId: v.id("agentRuns"),
    status: v.union(v.literal("ok"), v.literal("no-safe-plan")),
    trigger: v.string(),
    result: v.any(), // PlannerResult
    comparison: v.optional(v.any()), // Comparison: recommended vs. previous plan (or paying all cash)
    comparisonLabel: v.optional(v.string()),
    approval: v.union(v.literal("none"), v.literal("pending"), v.literal("approved"), v.literal("declined")),
    approvalMessage: v.optional(v.string()),
    // Caveats the plan was made under, e.g. "Credit data stale: payments capped".
    notes: v.optional(v.array(v.string())),
  }).index("by_run", ["runId"]),

  audit: defineTable({
    kind: auditKind,
    title: v.string(),
    detail: v.string(),
    runId: v.optional(v.id("agentRuns")),
  }),

  // Strategy comparison over simulated months (lib/planner/backtest.ts).
  backtests: defineTable({
    status: v.union(v.literal("running"), v.literal("done"), v.literal("error")),
    profileUpdatedAt: v.number(), // which profile version it describes
    scenario: v.string(),
    result: v.optional(v.any()), // BacktestResult
    error: v.optional(v.string()),
    durationMs: v.optional(v.number()),
  }),

  questions: defineTable({
    question: v.string(),
    status: v.union(v.literal("thinking"), v.literal("answered"), v.literal("error")),
    answer: v.optional(v.string()),
    mode: v.optional(agentMode),
    toolsUsed: v.optional(v.array(v.string())),
  }),
});
