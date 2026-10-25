// Live CRS sandbox import: log in, pull an Experian report for a provided
// test identity, normalize the tradelines, and load them as the profile.
import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { CRS_PERSONAS } from "../lib/crs/personas";
import { normalizeCrsReport, type CrsReport } from "../lib/crs/normalize";
import { mayaInput } from "../lib/planner/fixtures/maya";

const BASE_URL = "https://api-sandbox.stitchcredit.com/api";

export const lockState = internalQuery({
  args: {},
  handler: async (ctx) => await ctx.db.query("integrations").withIndex("by_name", (q) => q.eq("name", "crs")).first(),
});

export const lock = internalMutation({
  args: { reason: v.string() },
  handler: async (ctx, { reason }) => {
    const row = await ctx.db.query("integrations").withIndex("by_name", (q) => q.eq("name", "crs")).first();
    if (row) await ctx.db.patch(row._id, { lockedReason: reason });
    else await ctx.db.insert("integrations", { name: "crs", lockedReason: reason });
    await ctx.db.insert("audit", { kind: "data", title: "CRS locked", detail: reason });
  },
});

/** After fixing CRS_USERNAME / CRS_PASSWORD: npx convex run crs:unlock */
export const unlock = internalMutation({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("integrations").withIndex("by_name", (q) => q.eq("name", "crs")).first();
    if (row) await ctx.db.patch(row._id, { lockedReason: undefined });
  },
});

export const importPersona = action({
  args: { personaId: v.string() },
  handler: async (ctx, { personaId }): Promise<{ debts: number; skipped: number; score: number | null }> => {
    const persona = CRS_PERSONAS.find((p) => p.id === personaId);
    if (!persona) throw new Error(`Unknown test persona ${personaId}`);
    const username = process.env.CRS_USERNAME;
    const password = process.env.CRS_PASSWORD;
    if (!username || !password) throw new Error("CRS_USERNAME and CRS_PASSWORD are not set on the Convex deployment.");

    const identities = JSON.parse(process.env.CRS_PERSONAS_JSON ?? "{}") as Record<string, Record<string, unknown>>;
    const identity = identities[persona.id];
    if (!identity) throw new Error(`Test identity ${persona.id} is missing: set CRS_PERSONAS_JSON on the Convex deployment.`);

    const locked = await ctx.runQuery(internal.crs.lockState, {});
    if (locked?.lockedReason) throw new Error(`CRS is locked: ${locked.lockedReason}`);

    // One login attempt only: repeated failures disable the sandbox account.
    const login = await fetch(`${BASE_URL}/users/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const loginBody = (await login.json().catch(() => ({}))) as { token?: string };
    if (!login.ok || !loginBody.token) {
      const reason = `Login failed (HTTP ${login.status}). Not retrying; fix the credentials, then run: npx convex run crs:unlock`;
      await ctx.runMutation(internal.crs.lock, { reason });
      throw new Error(reason);
    }

    const res = await fetch(`${BASE_URL}/experian/credit-report/standard/${persona.config}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${loginBody.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(identity),
    });
    if (!res.ok) throw new Error(`CRS credit report failed (HTTP ${res.status})`);
    const report = (await res.json()) as CrsReport;
    const requestId = res.headers.get("RequestID") ?? "n/a";

    const { debts, collections, skipped, score } = normalizeCrsReport(report);
    if (debts.length === 0) {
      const errors = report.errorMessages?.length ? ` CRS returned ${report.errorMessages.length} error message(s).` : "";
      throw new Error(`No open card or loan balances in ${persona.name}'s report.${errors}`);
    }

    // Credit comes from CRS; cash flow stays on the fixture until Nessie is connected.
    await ctx.runMutation(internal.demo.loadProfile, {
      input: { ...mayaInput, debts, collections, shock: undefined },
      profileName: `${persona.name} · CRS test persona ${persona.id} (${persona.profile})`,
      sources: { credit: `CRS sandbox · Experian · ${persona.id}`, cash: "fixture (Nessie shape)" },
      ...(score !== null ? { creditScore: score } : {}),
      dataLog: [
        {
          title: "Credit report pulled from CRS sandbox",
          detail: `Experian ${persona.config} · request ${requestId} · ${debts.length} open debts${score !== null ? ` · score ${score}` : ""}`,
        },
        ...(collections.length
          ? [{
              title: "Collections kept out of the plan",
              detail: collections.map((c) => `${c.label} $${Math.round(c.balance).toLocaleString("en-US")}`).join(", ") + " · flagged for a counselor to negotiate",
            }]
          : []),
        ...(skipped.length
          ? [{ title: "Tradelines skipped", detail: skipped.map((s) => `${s.creditor} (${s.reason})`).join(", ") }]
          : []),
        { title: "APR and due dates", detail: "Not in CRS data; typical values used and labeled manual" },
        { title: "Cash history loaded", detail: `${mayaInput.historicalWeeklyIncome.length} weeks · fixture (Nessie shape)` },
      ],
    });
    return { debts: debts.length, skipped: skipped.length, score };
  },
});
