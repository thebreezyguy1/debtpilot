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

test("same-name accounts get distinct labels; a repeated account id is dropped", () => {
  const card = { creditorName: "NORTHSTAR BANK VISA", accountType: "Revolving", currentBalanceAmount: "400", creditLimitAmount: "5000" };
  const { debts, skipped } = normalizeCrsReport({
    tradelines: [
      { ...card, accountIdentifier: "REV-1", accountOpenedDate: "2010-10-19" },
      { ...card, accountIdentifier: "REV-6", accountOpenedDate: "2017-04-20" },
      { ...card, accountIdentifier: "REV-6", accountOpenedDate: "2017-04-20" },
    ],
  });
  assert.deepEqual(debts.map((d) => d.label), ["NORTHSTAR BANK VISA (opened 2010)", "NORTHSTAR BANK VISA (opened 2017)"]);
  assert.equal(new Set(debts.map((d) => d.id)).size, 2);
  assert.deepEqual(skipped, [{ creditor: "NORTHSTAR BANK VISA", reason: "duplicate entry" }]);
});

test("collections leave the plan; card status and past due are kept", () => {
  const { debts, collections } = normalizeCrsReport({
    tradelines: [
      { creditorName: "NATIONAL RECOVERY 1", accountIdentifier: "COLL-1", accountType: "Open", loanType: "Collection", businessType: "CollectionServices", currentRatingType: "Collection", currentBalanceAmount: "800", highBalanceAmount: "800", pastDueAmount: "800" },
      { creditorName: "FIRST CHOICE CARD 1", accountIdentifier: "L90-1", accountType: "Revolving", loanType: "CreditCard", currentRatingType: "Late90Days", currentBalanceAmount: "2850", creditLimitAmount: "3000", highBalanceAmount: "3000", pastDueAmount: "450" },
      { creditorName: "NO LIMIT CARD", accountIdentifier: "R-9", accountType: "Revolving", currentBalanceAmount: "500", highBalanceAmount: "900" },
    ],
  });
  assert.deepEqual(collections, [{ label: "NATIONAL RECOVERY 1", balance: 800, source: "CRS" }]);
  assert.deepEqual(debts.map((d) => d.label), ["FIRST CHOICE CARD 1", "NO LIMIT CARD"]);
  assert.equal(debts[0]!.status, "Late90Days");
  assert.equal(debts[0]!.pastDue, 450);
  assert.equal(debts[1]!.creditLimit, undefined, "a high balance is not a credit limit");
});
