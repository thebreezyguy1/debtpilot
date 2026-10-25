import type { PlannerInput, Shock } from "../types";

// Demo persona: freelance designer + delivery driver with irregular income.
// Synthetic data; field sources mirror what we expect from the CRS sandbox.
export const mayaInput: PlannerInput = {
  cashBalance: 1820,
  debts: [
    {
      id: "card-b",
      label: "Card B",
      kind: "revolving",
      balance: 2720,
      apr: 0.24,
      minimumPayment: 85,
      dueWeeks: [3, 7],
      creditLimit: 4500,
      sources: { balance: "CRS", creditLimit: "CRS", apr: "manual", minimumPayment: "manual", dueWeeks: "manual" },
    },
    {
      id: "card-a",
      label: "Card A",
      kind: "revolving",
      balance: 1220,
      apr: 0.189,
      minimumPayment: 40,
      dueWeeks: [3, 7],
      creditLimit: 3000,
      sources: { balance: "CRS", creditLimit: "CRS", apr: "manual", minimumPayment: "manual", dueWeeks: "manual" },
    },
    {
      id: "loan",
      label: "Personal loan",
      kind: "installment",
      balance: 5200,
      apr: 0.115,
      minimumPayment: 190,
      dueWeeks: [3, 7],
      sources: { balance: "CRS", apr: "CRS", minimumPayment: "CRS", dueWeeks: "CRS" },
    },
  ],
  historicalWeeklyIncome: [910, 520, 1180, 760, 0, 1040, 650, 890, 410, 980],
  incomeSources: [
    { label: "Freelance design", share: 0.55 },
    { label: "Delivery driving", share: 0.45 },
  ],
  expenses: [
    { label: "Rent (shared apt.)", amount: 1100, weeks: [2, 6], payWith: "cash" },
    { label: "Phone + utilities", amount: 45, weeks: "weekly", payWith: "cash" },
    { label: "Groceries + gas", amount: 210, weeks: "weekly", payWith: "cash-or-card" },
  ],
  horizonWeeks: 8,
  riskTolerance: 0.05,
  fees: { lateFee: 35, essentialLateFee: 75, penaltyApr: 0.2999, penaltyTailWeeks: 26 },
  scenarioCount: 2000,
  blockLength: 2,
  paymentStep: 25,
  seed: 42,
};

export const carRepair: Shock = {
  label: "Car repair",
  amount: 900,
  week: 0,
  payWith: "cash",
};
