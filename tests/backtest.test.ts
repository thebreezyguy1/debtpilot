import assert from "node:assert/strict";
import { test } from "node:test";
import { plannerInputAt, runBacktest, DEFAULT_BACKTEST } from "../lib/planner/backtest";
import { newPathState } from "../lib/planner/simulate";
import { mayaInput } from "../lib/planner/fixtures/maya";

const small = { futures: 20, weeks: 12, innerScenarios: 40, innerStep: 200, avalancheBuffers: [0, 1500] };

test("planner view at week 5 re-bases the monthly schedule", () => {
  const view = plannerInputAt(mayaInput, newPathState(mayaInput), 5, DEFAULT_BACKTEST);
  // Minimums due in weeks 3, 7, 11, … → weeks 7 and 11 are relative weeks 3 and 7.
  assert.deepEqual(view.debts[0]!.dueWeeks, [3, 7]);
  // Rent due in weeks 2, 6, 10, … → relative weeks 2 and 6.
  assert.deepEqual(view.expenses.find((e) => e.label.startsWith("Rent"))!.weeks, [2, 6]);
});

test("income changes are shifted and trimmed for later decisions", () => {
  const input = { ...mayaInput, incomeChanges: [{ label: "Lost gig", fromWeek: 1, weeks: 6, multiplier: 0.5 }] };
  const view = plannerInputAt(input, newPathState(input), 5, DEFAULT_BACKTEST);
  assert.deepEqual(view.incomeChanges, [{ label: "Lost gig", fromWeek: 1, weeks: 2, multiplier: 0.5 }]);
});

test("backtest is deterministic and covers every strategy", () => {
  const a = runBacktest(mayaInput, small);
  const b = runBacktest(mayaInput, small);
  assert.deepEqual(a, b);
  assert.deepEqual(a.policies.map((p) => p.id), ["debtpilot", "avalanche-0", "avalanche-1500", "minimums"]);
  assert.equal(a.policies[0]!.meanDebtByWeek.length, small.weeks + 1);
});

test("keeping no cash buffer misses more often than keeping $1,500", () => {
  const r = runBacktest(mayaInput, small);
  const noBuffer = r.policies.find((p) => p.id === "avalanche-0")!;
  const buffer = r.policies.find((p) => p.id === "avalanche-1500")!;
  assert.ok(noBuffer.missProbability > buffer.missProbability);
  assert.ok(noBuffer.meanDebtPaidDown > buffer.meanDebtPaidDown);
});
