import { generateIncomePaths, percentile } from "./random";
import { availableCashToday, simulatePath } from "./simulate";
import type { CandidateResult, CashBand, Comparison, Debt, PathOutcome, PlannerInput, PlannerResult } from "./types";

/** Avalanche: send the extra amount to the highest-APR debt first, spilling over when it's paid off. */
export function allocateByHighestApr(debts: Debt[], extra: number): Record<string, number> {
  const allocation: Record<string, number> = {};
  let remaining = extra;
  for (const d of [...debts].sort((x, y) => y.apr - x.apr)) {
    if (remaining <= 0) break;
    const pay = Math.min(remaining, d.balance);
    if (pay > 0) allocation[d.id] = pay;
    remaining -= pay;
  }
  return allocation;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

function summarize(
  extraPayment: number,
  allocation: Record<string, number>,
  outcomes: PathOutcome[],
  riskTolerance: number,
): CandidateResult {
  const n = outcomes.length;
  const p = outcomes.filter((o) => o.missed).length / n;
  const expectedInterest = mean(outcomes.map((o) => o.interest));
  const expectedFees = mean(outcomes.map((o) => o.fees));
  const expectedPenaltyTail = mean(outcomes.map((o) => o.penaltyTail));
  return {
    extraPayment,
    allocation,
    missProbability: p,
    missStdError: Math.sqrt((p * (1 - p)) / n),
    expectedInterest,
    expectedFees,
    expectedPenaltyTail,
    expectedCost: expectedInterest + expectedFees + expectedPenaltyTail,
    p10EndingCash: percentile(outcomes.map((o) => o.endingCash).sort((a, b) => a - b), 0.1),
    meanEndingDebt: mean(outcomes.map((o) => o.endingDebt)),
    feasible: p <= riskTolerance,
  };
}

function incomePaths(input: PlannerInput): number[][] {
  return generateIncomePaths(
    input.historicalWeeklyIncome,
    input.horizonWeeks,
    input.scenarioCount,
    input.blockLength,
    input.seed,
  );
}

function runCandidate(input: PlannerInput, paths: number[][], requested: number) {
  // You can't pay more than the cash you have today; report what would actually be paid.
  const extra = Math.max(0, Math.min(requested, availableCashToday(input)));
  const allocation = allocateByHighestApr(input.debts, extra);
  const outcomes = paths.map((income) => simulatePath(input, allocation, income));
  return { result: summarize(extra, allocation, outcomes, input.riskTolerance), outcomes };
}

function cashBands(outcomes: PathOutcome[], horizonWeeks: number): CashBand[] {
  const bands: CashBand[] = [];
  for (let week = 0; week <= horizonWeeks; week++) {
    const col = outcomes.map((o) => o.cashByWeek[week] ?? 0).sort((a, b) => a - b);
    bands.push({ week, p10: percentile(col, 0.1), p50: percentile(col, 0.5), p90: percentile(col, 0.9) });
  }
  return bands;
}

/**
 * Chance-constrained search: among extra payments whose modeled miss
 * probability is within the user's tolerance, pick the lowest expected cost
 * (interest + late fees + penalty-APR tail). Ties go to the larger payment.
 */
export function findPlan(input: PlannerInput): PlannerResult {
  const paths = incomePaths(input);
  const maxExtra = Math.min(availableCashToday(input), input.maxExtraPayment ?? Infinity);
  const frontier: CandidateResult[] = [];
  const outcomesByPayment = new Map<number, PathOutcome[]>();

  for (let extra = 0; extra <= maxExtra + 1e-9; extra += input.paymentStep) {
    const { result, outcomes } = runCandidate(input, paths, extra);
    frontier.push(result);
    outcomesByPayment.set(extra, outcomes);
  }

  const feasible = frontier.filter((c) => c.feasible);
  const pick = (cands: CandidateResult[], score: (c: CandidateResult) => number) =>
    cands.reduce((best, c) => {
      const d = score(c) - score(best);
      return d < -1e-9 || (Math.abs(d) <= 1e-9 && c.extraPayment > best.extraPayment) ? c : best;
    });

  // No candidate meets the risk limit (not even $0): hold cash, flag it.
  const recommended =
    feasible.length > 0 ? pick(feasible, (c) => c.expectedCost) : frontier[0]!;

  return {
    status: feasible.length > 0 ? "ok" : "no-safe-plan",
    recommended,
    frontier,
    cashBands: cashBands(outcomesByPayment.get(recommended.extraPayment)!, input.horizonWeeks),
    scenarios: paths.length,
    riskTolerance: input.riskTolerance,
  };
}

/** Score two extra payments on the identical set of income futures. */
export function comparePlans(input: PlannerInput, extraA: number, extraB: number): Comparison {
  const paths = incomePaths(input);
  const a = runCandidate(input, paths, extraA).result;
  const b = runCandidate(input, paths, extraB).result;
  return {
    a,
    b,
    deltaExpectedCost: b.expectedCost - a.expectedCost,
    deltaExpectedInterest: b.expectedInterest - a.expectedInterest,
    deltaMissProbability: b.missProbability - a.missProbability,
  };
}
