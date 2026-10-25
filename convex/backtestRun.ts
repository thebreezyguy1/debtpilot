"use node";

// CPU-heavy (~15 s): runs in a Node action so it never blocks the dashboard.
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { runBacktest } from "../lib/planner/backtest";

export const run = internalAction({
  args: { backtestId: v.id("backtests") },
  handler: async (ctx, { backtestId }) => {
    const started = Date.now();
    try {
      const input = await ctx.runQuery(internal.backtest.input, {});
      if (!input) throw new Error("No profile loaded");
      const result = runBacktest(input);
      await ctx.runMutation(internal.backtest.finish, { backtestId, result, durationMs: Date.now() - started });
    } catch (err) {
      const error = err instanceof Error ? err.message : "Backtest failed";
      await ctx.runMutation(internal.backtest.finish, { backtestId, error, durationMs: Date.now() - started });
    }
  },
});
