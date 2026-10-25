// Capital One Nessie → weekly income history. Endpoint shapes follow the public
// Nessie API (key as ?key=, /accounts/{id}, /accounts/{id}/deposits); verify
// with a hackathon key before relying on them in the demo.

export type NessieDeposit = {
  _id?: string;
  amount?: number;
  transaction_date?: string; // YYYY-MM-DD
  status?: string;
  description?: string;
};

export type NessieAccount = { _id?: string; balance?: number; nickname?: string; type?: string };

const DAY = 86_400_000;

/**
 * Bucket completed deposits into calendar weeks ending at `asOf`, oldest first.
 * Weeks with no deposits count as $0: those are exactly the dry spells the planner needs to see.
 */
export function weeklyIncomeFromDeposits(deposits: NessieDeposit[], weeks: number, asOf: Date): number[] {
  const end = asOf.getTime();
  const buckets = new Array<number>(weeks).fill(0);
  for (const d of deposits) {
    if (d.status && d.status.toLowerCase() === "cancelled") continue;
    const amount = Number(d.amount);
    // Nessie dates have no time of day: count each as the start of its (UTC) day, so a
    // deposit dated today is never treated as in the future.
    const when = d.transaction_date ? Date.parse(`${d.transaction_date}T00:00:00Z`) : NaN;
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(when) || when > end) continue;
    const weeksAgo = Math.floor((end - when) / (7 * DAY));
    if (weeksAgo < weeks) buckets[weeks - 1 - weeksAgo]! += amount;
  }
  return buckets.map((x) => Math.round(x));
}

/** Dates for seeding a demo account: one deposit per week, ending this week. */
export function seedDepositDates(weeks: number, asOf: Date): string[] {
  return Array.from({ length: weeks }, (_, i) =>
    new Date(asOf.getTime() - (weeks - 1 - i) * 7 * DAY).toISOString().slice(0, 10),
  );
}
