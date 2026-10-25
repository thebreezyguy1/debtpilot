import { v } from "convex/values";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { PlannerInput } from "../lib/planner/types";

/** Compare strategies on the current profile, including any events applied so far. */
export const start = mutation({
  args: {},
  handler: async (ctx) => {
    const profile = await ctx.db.query("profiles").first();
    if (!profile) throw new Error("Load a profile first");
    const running = await ctx.db
      .query("backtests")
      .filter((q) => q.eq(q.field("status"), "running"))
      .first();
    if (running) return running._id;
    const input = profile.input as PlannerInput;
    const events = [
      input.shock ? `${input.shock.label} $${Math.round(input.shock.amount).toLocaleString("en-US")}` : null,
      ...(input.incomeChanges ?? []).map((c) => c.label),
    ].filter(Boolean);
    const backtestId = await ctx.db.insert("backtests", {
      status: "running",
      profileUpdatedAt: profile.updatedAt,
      scenario: `${profile.profileName ?? "Profile"}${events.length ? ` · ${events.join(", ")}` : ""}`,
    });
    await ctx.scheduler.runAfter(0, internal.backtestRun.run, { backtestId });
    return backtestId;
  },
});

export const input = internalQuery({
  args: {},
  handler: async (ctx) => ((await ctx.db.query("profiles").first())?.input ?? null) as PlannerInput | null,
});

export const finish = internalMutation({
  args: {
    backtestId: v.id("backtests"),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    durationMs: v.number(),
  },
  handler: async (ctx, { backtestId, result, error, durationMs }) => {
    await ctx.db.patch(backtestId, { status: error ? "error" : "done", result, error, durationMs });
  },
});
