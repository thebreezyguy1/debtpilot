import assert from "node:assert/strict";
import { test } from "node:test";
import { seedDepositDates, weeklyIncomeFromDeposits } from "../lib/nessie/normalize";

const asOf = new Date("2026-10-24T12:00:00Z");

test("deposits are bucketed by week, oldest first, with empty weeks as $0", () => {
  const weekly = weeklyIncomeFromDeposits(
    [
      { amount: 500, transaction_date: "2026-10-23", status: "completed" },
      { amount: 410, transaction_date: "2026-10-20", status: "completed" },
      { amount: 1180, transaction_date: "2026-10-09" },
      { amount: 999, transaction_date: "2026-10-22", status: "cancelled" },
      { amount: 50, transaction_date: "2026-11-30" }, // future: ignored
    ],
    4,
    asOf,
  );
  assert.deepEqual(weekly, [0, 1180, 0, 910]);
});

test("seed dates produce one deposit in each of the last N weeks", () => {
  const dates = seedDepositDates(10, asOf);
  const weekly = weeklyIncomeFromDeposits(dates.map((d) => ({ amount: 100, transaction_date: d })), 10, asOf);
  assert.deepEqual(weekly, new Array(10).fill(100));
});
