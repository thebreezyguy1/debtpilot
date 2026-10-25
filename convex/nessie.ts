// Capital One Nessie sandbox: cash balance + deposit history → weekly income.
// Optional by design: if this fails, the demo keeps the fixture cash data.
import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { seedDepositDates, weeklyIncomeFromDeposits, type NessieAccount, type NessieDeposit } from "../lib/nessie/normalize";
import { mayaInput } from "../lib/planner/fixtures/maya";

const WEEKS = 10;

function config() {
  const key = process.env.NESSIE_API_KEY;
  if (!key) throw new Error("NESSIE_API_KEY is not set on the Convex deployment.");
  return { key, base: (process.env.NESSIE_BASE_URL ?? "https://api.nessieisreal.com").replace(/\/$/, "") };
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const { key, base } = config();
  let res: Response;
  try {
    res = await fetch(`${base}${path}?key=${encodeURIComponent(key)}`, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error(`Can't reach the Nessie sandbox at ${base}. It may be down; the demo keeps the fixture cash data.`);
  }
  if (res.status >= 500) throw new Error(`The Nessie sandbox is having problems (HTTP ${res.status}). Try again later; the demo keeps the fixture cash data.`);
  if (res.status === 401 || res.status === 403) throw new Error("Nessie rejected the API key (NESSIE_API_KEY).");
  if (!res.ok) throw new Error(`Nessie ${method} ${path} failed (HTTP ${res.status})`);
  return (await res.json()) as T;
}

type Created = { objectCreated?: { _id?: string } };

export const savedAccount = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("integrations").withIndex("by_name", (q) => q.eq("name", "nessie")).first())?.accountId ?? null,
});

export const saveAccount = internalMutation({
  args: { accountId: v.string() },
  handler: async (ctx, { accountId }) => {
    const row = await ctx.db.query("integrations").withIndex("by_name", (q) => q.eq("name", "nessie")).first();
    if (row) await ctx.db.patch(row._id, { accountId });
    else await ctx.db.insert("integrations", { name: "nessie", accountId });
  },
});

/** Read the account's balance and deposits, and load them as the cash side of the profile. */
export const importCash = action({
  args: { accountId: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ accountId: string; weeklyIncome: number[]; balance: number }> => {
    const accountId = args.accountId ?? (await ctx.runQuery(internal.nessie.savedAccount, {}));
    if (!accountId) throw new Error("No Nessie account yet: seed a demo account first.");
    const account = await call<NessieAccount>("GET", `/accounts/${accountId}`);
    const deposits = await call<NessieDeposit[]>("GET", `/accounts/${accountId}/deposits`);
    const weeklyIncome = weeklyIncomeFromDeposits(Array.isArray(deposits) ? deposits : [], WEEKS, new Date());
    const balance = Number(account.balance);
    if (!Number.isFinite(balance)) throw new Error("Nessie account has no balance field");

    await ctx.runMutation(internal.nessie.saveAccount, { accountId });
    await ctx.runMutation(internal.demo.updateCash, {
      cashBalance: balance,
      weeklyIncome,
      cashSource: `Nessie sandbox · account …${accountId.slice(-6)}`,
      detail: `Balance $${Math.round(balance).toLocaleString("en-US")} · ${deposits.length} deposits → ${WEEKS} weeks of income`,
    });
    return { accountId, weeklyIncome, balance };
  },
});

/**
 * Create a sandbox customer + checking account and post the demo persona's
 * weekly income as deposits, then import it back. Shows a real round trip.
 */
export const seedDemoAccount = action({
  args: {},
  handler: async (ctx): Promise<{ accountId: string }> => {
    const customer = await call<Created>("POST", "/customers", {
      first_name: "Maya",
      last_name: "Demo",
      address: { street_number: "1", street_name: "Hackathon Way", city: "San Francisco", state: "CA", zip: "94103" },
    });
    const customerId = customer.objectCreated?._id;
    if (!customerId) throw new Error("Nessie did not return a customer id");

    const account = await call<Created>("POST", `/customers/${customerId}/accounts`, {
      type: "Checking",
      nickname: "DebtPilot demo",
      rewards: 0,
      balance: mayaInput.cashBalance,
    });
    const accountId = account.objectCreated?._id;
    if (!accountId) throw new Error("Nessie did not return an account id");

    const dates = seedDepositDates(WEEKS, new Date());
    for (const [i, amount] of mayaInput.historicalWeeklyIncome.slice(-WEEKS).entries()) {
      if (amount <= 0) continue; // a $0 week is simply no deposit
      await call("POST", `/accounts/${accountId}/deposits`, {
        medium: "balance",
        transaction_date: dates[i],
        status: "completed",
        amount,
        description: "Gig payout",
      });
    }
    await ctx.runMutation(internal.nessie.saveAccount, { accountId });
    return { accountId };
  },
});
