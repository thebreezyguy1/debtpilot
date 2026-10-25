import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allocateByHighestApr,
  availableCashToday,
  comparePlans,
  findPlan,
  simulatePath,
  type PlannerInput,
} from "../lib/planner";
import { carRepair, mayaInput } from "../lib/planner/fixtures/maya";

const fast: PlannerInput = { ...mayaInput, scenarioCount: 500 };

test("avalanche allocation fills the highest APR first and spills over", () => {
  const alloc = allocateByHighestApr(mayaInput.debts, 3000);
  assert.deepEqual(alloc, { "card-b": 2720, "card-a": 280 });
});

test("same seed gives identical plans", () => {
  assert.deepEqual(findPlan(fast).recommended, findPlan(fast).recommended);
});

test("recommendation respects the risk limit and available cash", () => {
  const plan = findPlan(fast);
  assert.equal(plan.status, "ok");
  assert.ok(plan.recommended.missProbability <= fast.riskTolerance);
  assert.ok(plan.recommended.extraPayment <= availableCashToday(fast));
  assert.equal(plan.cashBands.length, fast.horizonWeeks + 1);
});

test("paying everything is riskier and costs more in expectation", () => {
  const plan = findPlan(fast);
  const cmp = comparePlans(fast, plan.recommended.extraPayment, availableCashToday(fast));
  assert.ok(cmp.deltaExpectedInterest < 0, "aggressive plan saves interest");
  assert.ok(cmp.deltaExpectedCost > 0, "but late fees and penalty APR outweigh it");
  assert.ok(cmp.deltaMissProbability > 0);
});

test("a surprise expense lowers the safe payment", () => {
  const before = findPlan(fast).recommended.extraPayment;
  const after = findPlan({ ...fast, shock: carRepair });
  assert.equal(after.status, "ok");
  assert.ok(after.recommended.extraPayment < before);
});

test("comparisons cap a payment at the cash available today", () => {
  const input = { ...fast, shock: carRepair };
  const cmp = comparePlans(input, 0, 5000);
  assert.equal(cmp.b.extraPayment, availableCashToday(input));
});

test("a shock with no safe option holds cash and says so", () => {
  const plan = findPlan({ ...fast, shock: { ...carRepair, amount: 1500 } });
  assert.equal(plan.status, "no-safe-plan");
  assert.equal(plan.recommended.extraPayment, 0);
  assert.equal(plan.recommended.feasible, false);
});

const tiny: PlannerInput = {
  ...mayaInput,
  cashBalance: 0,
  debts: [
    {
      id: "card",
      label: "Card",
      kind: "revolving",
      balance: 1000,
      apr: 0.2,
      minimumPayment: 50,
      dueWeeks: [1],
      creditLimit: 2000,
      sources: {},
    },
  ],
  expenses: [{ label: "Groceries", amount: 100, weeks: "weekly", payWith: "cash-or-card" }],
  horizonWeeks: 1,
};

test("card-eligible spending is re-borrowed on the card instead of missed", () => {
  const out = simulatePath(tiny, {}, [50]);
  assert.equal(out.missed, false);
  assert.ok(out.endingDebt > 1000, "groceries were charged to the card");
});

test("a missed minimum adds a late fee and a penalty-APR tail", () => {
  const out = simulatePath(tiny, {}, [0]);
  assert.equal(out.missed, true);
  assert.equal(out.fees, tiny.fees.lateFee);
  assert.ok(out.penaltyTail > 0);
});

test("lost income for several weeks lowers the safe payment", () => {
  const base = findPlan(fast).recommended.extraPayment;
  const plan = findPlan({ ...fast, incomeChanges: [{ label: "Lost gig", fromWeek: 1, weeks: 3, multiplier: 0 }] });
  assert.ok(plan.recommended.extraPayment < base);
});

test("income changes only apply inside their window", () => {
  const input = { ...tiny, horizonWeeks: 1, incomeChanges: [{ label: "Later cut", fromWeek: 2, weeks: 2, multiplier: 0 }] };
  assert.equal(simulatePath(input, {}, [50]).missed, false);
});

test("safe mode caps the recommendation but not comparisons", () => {
  const capped = findPlan({ ...fast, maxExtraPayment: 300 });
  assert.ok(capped.recommended.extraPayment <= 300);
  assert.equal(comparePlans({ ...fast, maxExtraPayment: 300 }, 0, 1000).b.extraPayment, 1000);
});

test("a past-due amount is owed at the next due date, then cleared", () => {
  const input = { ...tiny, cashBalance: 100, debts: [{ ...tiny.debts[0]!, pastDue: 60 }], expenses: [] };
  // $50 minimum + $60 past due = $110 due in week 1; $100 cash + $0 income is short.
  assert.equal(simulatePath(input, {}, [0]).missed, true);
  assert.equal(simulatePath(input, {}, [10]).missed, false);
});
