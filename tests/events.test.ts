import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEvent, rulesInterpret } from "../lib/agent/events";
import { mayaInput } from "../lib/planner/fixtures/maya";

test("rules parser: lost income for N weeks", () => {
  const e = rulesInterpret("I lost my delivery gig for 3 weeks", mayaInput);
  assert.equal(e.kind, "income_change");
  assert.equal(e.weeks, 3);
  // Maya also earns from design work, so losing the delivery gig keeps ~55% of income.
  assert.equal(e.income_multiplier, 0.55);
});

test("rules parser: half income, word numbers", () => {
  const e = rulesInterpret("Shifts cut in half for two weeks", mayaInput);
  assert.equal(e.kind, "income_change");
  assert.equal(e.weeks, 2);
  assert.equal(e.income_multiplier, 0.5);
});

test("rules parser: APR change on a named card", () => {
  const e = rulesInterpret("Card A raised my APR to 29.99%", mayaInput);
  assert.equal(e.kind, "apr_change");
  assert.equal(e.new_apr_pct, 29.99);
  assert.equal(e.debt_label, "Card A");
});

test("rules parser: dollar expense and non-events", () => {
  assert.equal(rulesInterpret("Vet bill, $400", mayaInput).amount, 400);
  assert.equal(rulesInterpret("hello there", mayaInput).kind, "not_a_financial_event");
});

test("applyEvent clamps and targets the highest-APR card when no debt is named", () => {
  const base = { kind: "apr_change" as const, label: "Rate hike", amount: 0, weeks: 0, income_multiplier: 1, debt_label: "", new_apr_pct: 99, explanation: "" };
  const out = applyEvent(mayaInput, base)!;
  const cardB = out.input.debts.find((d) => d.id === "card-b")!;
  assert.equal(cardB.apr, 0.6);
  assert.equal(cardB.sources.apr, "event");
});

test("applyEvent stacks expenses and bounds income-change weeks", () => {
  const exp = { kind: "expense" as const, label: "Vet", amount: 400, weeks: 0, income_multiplier: 1, debt_label: "", new_apr_pct: 0, explanation: "" };
  const once = applyEvent(mayaInput, exp)!.input;
  assert.equal(applyEvent(once, exp)!.input.shock!.amount, 800);
  const inc = { ...exp, kind: "income_change" as const, weeks: 40, income_multiplier: 0 };
  assert.equal(applyEvent(mayaInput, inc)!.input.incomeChanges![0]!.weeks, mayaInput.horizonWeeks);
});
