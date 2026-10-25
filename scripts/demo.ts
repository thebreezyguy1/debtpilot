import { availableCashToday, comparePlans, findPlan, type CandidateResult, type PlannerInput } from "../lib/planner";
import { carRepair, mayaInput } from "../lib/planner/fixtures/maya";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (p: number) => `${(p * 100).toFixed(1)}%`;

function line(label: string, c: CandidateResult) {
  console.log(
    `  ${label.padEnd(14)} pay ${usd(c.extraPayment).padStart(6)}  miss ${pct(c.missProbability).padStart(6)} ±${pct(c.missStdError)}` +
      `  cost ${usd(c.expectedCost).padStart(5)} (interest ${usd(c.expectedInterest)}, fees ${usd(c.expectedFees)}, penalty tail ${usd(c.expectedPenaltyTail)})`,
  );
}

function scenario(title: string, input: PlannerInput, alternative: number) {
  const plan = findPlan(input);
  console.log(`\n== ${title} ==  status: ${plan.status}, ${plan.scenarios} paths, limit ${pct(plan.riskTolerance)}`);
  const cmp = comparePlans(input, plan.recommended.extraPayment, alternative);
  line("Recommended", cmp.a);
  line("Alternative", cmp.b);
  console.log(`  Δ cost ${usd(cmp.deltaExpectedCost)}, Δ interest ${usd(cmp.deltaExpectedInterest)}, Δ miss ${pct(cmp.deltaMissProbability)}`);
  console.log("  Frontier (every $100):");
  for (const c of plan.frontier.filter((c) => c.extraPayment % 100 === 0)) {
    console.log(`    ${usd(c.extraPayment).padStart(6)}  miss ${pct(c.missProbability).padStart(6)}  cost ${usd(c.expectedCost).padStart(5)}${c.feasible ? "" : "  ✗"}`);
  }
  console.log("  Cash bands (p10 / p50 / p90):");
  console.log("    " + plan.cashBands.map((b) => `w${b.week} ${usd(b.p10)}/${usd(b.p50)}/${usd(b.p90)}`).join("  "));
  return plan;
}

const before = scenario("Before shock (vs. paying all cash)", mayaInput, availableCashToday(mayaInput));
scenario("After $900 car repair (vs. keeping the old plan)", { ...mayaInput, shock: carRepair }, before.recommended.extraPayment);
