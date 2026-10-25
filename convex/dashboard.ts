import { query } from "./_generated/server";
import type { PlannerInput } from "../lib/planner/types";
import { CRS_PERSONAS } from "../lib/crs/personas";

/** Everything the dashboard renders, as one live query. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const profile = await ctx.db.query("profiles").first();
    const latestRun = await ctx.db.query("agentRuns").order("desc").first();
    const plan = await ctx.db.query("plans").order("desc").first();
    const audit = (await ctx.db.query("audit").order("desc").take(40)).reverse();
    const questions = await ctx.db.query("questions").order("desc").take(5);
    const crs = await ctx.db.query("integrations").withIndex("by_name", (q) => q.eq("name", "crs")).first();
    const backtest = await ctx.db.query("backtests").order("desc").first();
    const feed = await ctx.db.query("integrations").withIndex("by_name", (q) => q.eq("name", "crs_feed")).first();
    const nessie = await ctx.db.query("integrations").withIndex("by_name", (q) => q.eq("name", "nessie")).first();
    return {
      input: (profile?.input ?? null) as PlannerInput | null,
      profileName: profile?.profileName ?? "Maya R. · freelance designer + delivery driver",
      sources: profile?.sources ?? { credit: "fixture (CRS shape)", cash: "fixture (Nessie shape)" },
      creditScore: profile?.creditScore ?? null,
      creditFeed: { down: Boolean(feed?.outageSince), downSince: feed?.outageSince ?? null, lastSyncedAt: profile?.creditSyncedAt ?? null },
      latestRun,
      plan,
      audit,
      questions,
      backtest: backtest
        ? { ...backtest, stale: profile ? backtest.profileUpdatedAt !== profile.updatedAt : false }
        : null,
      // Only whether credentials exist, never their values.
      integrations: {
        crsConfigured: Boolean(process.env.CRS_USERNAME && process.env.CRS_PASSWORD),
        crsLocked: crs?.lockedReason ?? null,
        nessieConfigured: Boolean(process.env.NESSIE_API_KEY),
        nessieAccount: nessie?.accountId ? `…${nessie.accountId.slice(-6)}` : null,
        personas: CRS_PERSONAS.map((p) => ({ id: p.id, name: p.name, profile: p.profile, summary: p.summary })),
      },
    };
  },
});
