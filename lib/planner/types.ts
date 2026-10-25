// Normalized financial state. Every sponsor adapter (CRS, Nessie, manual)
// produces these types; the engine never sees raw API responses.

export type DataSource = "CRS" | "Nessie" | "manual" | "event";

export type Debt = {
  id: string;
  label: string;
  kind: "revolving" | "installment";
  balance: number;
  apr: number; // 0.24 = 24%
  minimumPayment: number;
  /** Weeks within the horizon (1-based) when the minimum is due. */
  dueWeeks: number[];
  /** Revolving only: lets the simulator re-borrow on a card that was paid down. */
  creditLimit?: number;
  /** Amount already past due, as reported by the bureau. Owed at the next due date, on top of the minimum. */
  pastDue?: number;
  /** Bureau payment status, e.g. "AsAgreed", "Late30Days", "Late90Days". */
  status?: string;
  sources: Partial<Record<"balance" | "apr" | "minimumPayment" | "dueWeeks" | "creditLimit", DataSource>>;
};

export type Expense = {
  label: string;
  amount: number;
  /** "weekly" or the specific weeks (1-based) it is due. */
  weeks: "weekly" | number[];
  /** Rent can't go on a card; groceries and gas can. */
  payWith: "cash" | "cash-or-card";
};

export type Shock = {
  label: string;
  amount: number;
  /** 0 = already happened, before today's payment decision. */
  week: number;
  payWith: "cash" | "cash-or-card";
};

/** Income runs at `multiplier` × normal for `weeks` weeks starting at `fromWeek` (1-based). */
export type IncomeChange = {
  label: string;
  fromWeek: number;
  weeks: number;
  multiplier: number; // 0 = no income at all, 0.5 = half
};

export type FeePolicy = {
  lateFee: number;
  /** Charged when a cash-only bill (rent) can't be paid in full. */
  essentialLateFee: number;
  penaltyApr: number;
  /** How long a penalty APR keeps costing money after the horizon ends. */
  penaltyTailWeeks: number;
};

export type PlannerInput = {
  cashBalance: number;
  debts: Debt[];
  historicalWeeklyIncome: number[];
  expenses: Expense[];
  shock?: Shock;
  incomeChanges?: IncomeChange[];
  /** Debts already in collections. Not part of the payment plan: a counselor negotiates these. */
  collections?: { label: string; balance: number; source: DataSource }[];
  /** Where income comes from, as shares of the total (lets "lost one gig" mean a partial drop). */
  incomeSources?: { label: string; share: number }[];
  horizonWeeks: number;
  /** Max acceptable probability of missing any required payment. */
  riskTolerance: number;
  fees: FeePolicy;
  scenarioCount: number;
  /** Income is resampled in runs of this many weeks so dry spells stay together. */
  blockLength: number;
  paymentStep: number;
  /** Safe mode: never recommend more than this (e.g. while credit data is stale). Comparisons are not capped. */
  maxExtraPayment?: number;
  seed: number;
};

export type PathOutcome = {
  missed: boolean;
  interest: number;
  fees: number;
  penaltyTail: number;
  endingCash: number;
  endingDebt: number;
  cashByWeek: number[];
};

export type CandidateResult = {
  extraPayment: number;
  allocation: Record<string, number>;
  missProbability: number;
  /** Standard error of missProbability from Monte Carlo sampling. */
  missStdError: number;
  expectedInterest: number;
  expectedFees: number;
  expectedPenaltyTail: number;
  /** interest + late fees + penalty APR tail */
  expectedCost: number;
  p10EndingCash: number;
  meanEndingDebt: number;
  feasible: boolean;
};

export type CashBand = { week: number; p10: number; p50: number; p90: number };

export type PlannerResult = {
  status: "ok" | "no-safe-plan";
  recommended: CandidateResult;
  /** Every candidate evaluated: the risk/cost frontier for the UI. */
  frontier: CandidateResult[];
  cashBands: CashBand[];
  scenarios: number;
  riskTolerance: number;
};

export type Comparison = {
  a: CandidateResult;
  b: CandidateResult;
  deltaExpectedCost: number; // b - a
  deltaExpectedInterest: number;
  deltaMissProbability: number;
};
