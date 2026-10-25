import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeCrsReport, type CrsReport } from "../lib/crs/normalize";

// Shaped like the CRS Standard Format response (amounts are strings).
const report: CrsReport = {
  scores: [{ scoreValue: "540", modelName: "VantageScore 4" }],
  tradelines: [
    { creditorName: "CAPITAL BANK", accountType: "Revolving", currentBalanceAmount: "4,850", creditLimitAmount: "5000", monthlyPaymentAmount: "145", pastDueAmount: "290" },
    { creditorName: "AUTO FINANCE", accountType: "Installment", loanType: "Auto", currentBalanceAmount: "9200", monthlyPaymentAmount: "0" },
    { creditorName: "HOME LENDER", accountType: "Mortgage", currentBalanceAmount: "210000", monthlyPaymentAmount: "1400" },
    { creditorName: "OLD STORE CARD", accountType: "Revolving", currentBalanceAmount: "0", creditLimitAmount: "800" },
    { creditorName: "CLOSED CARD", accountType: "Revolving", currentBalanceAmount: "300", accountClosedDate: "2024-02-01" },
  ],
};

test("keeps open card and loan balances, skips mortgage, zero and closed accounts", () => {
  const { debts, skipped, score } = normalizeCrsReport(report);
  assert.deepEqual(debts.map((d) => d.label), ["CAPITAL BANK", "AUTO FINANCE"]);
  assert.deepEqual(skipped.map((s) => s.reason), ["mortgage", "no balance", "closed"]);
  assert.equal(score, 540);
});

test("CRS fields are labeled CRS; APR and due dates are labeled manual", () => {
  const [card, auto] = normalizeCrsReport(report).debts;
  assert.equal(card!.kind, "revolving");
  assert.equal(card!.balance, 4850);
  assert.equal(card!.creditLimit, 5000);
  assert.equal(card!.minimumPayment, 145);
  assert.equal(card!.pastDue, 290);
  assert.deepEqual(card!.sources, { balance: "CRS", apr: "manual", minimumPayment: "CRS", dueWeeks: "manual", creditLimit: "CRS" });
  // A missing/zero monthly payment falls back to a labeled estimate.
  assert.equal(auto!.kind, "installment");
  assert.equal(auto!.minimumPayment, 276);
  assert.equal(auto!.sources.minimumPayment, "manual");
});

test("an empty or error report yields no debts", () => {
  assert.deepEqual(normalizeCrsReport({ errorMessages: [{}] }).debts, []);
});
