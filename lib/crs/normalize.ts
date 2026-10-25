// CRS Standard Format → DebtPilot Debt[]. The one place that knows CRS field
// names; a CRS change touches this file, not the engine, agent or UI.
import type { Debt } from "../planner/types";

/** The subset of a CRS Standard Format tradeline we read (all amounts are strings). */
export type CrsTradeline = {
  accountIdentifier?: string;
  accountType?: string;
  loanType?: string;
  creditorName?: string;
  accountClosedDate?: string;
  accountStatusType?: string;
  currentBalanceAmount?: string;
  creditLimitAmount?: string;
  highBalanceAmount?: string;
  monthlyPaymentAmount?: string;
  pastDueAmount?: string;
};

export type CrsReport = {
  tradelines?: CrsTradeline[];
  scores?: { scoreValue?: string; modelName?: string }[];
  errorMessages?: unknown[];
};

export type NormalizedCredit = {
  debts: Debt[];
  skipped: { creditor: string; reason: string }[];
  score: number | null;
};

// CRS doesn't report APR or due dates. These typical values are labeled
// "manual" wherever they're used so the demo never claims they came from CRS.
const MANUAL_APR = { revolving: 0.228, installment: 0.115 };
const MANUAL_DUE_WEEKS = [3, 7];

function amount(s: string | undefined): number | null {
  if (s === undefined || s === null || s === "") return null;
  const n = Number(String(s).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function classify(t: CrsTradeline): "revolving" | "installment" | "mortgage" {
  const text = `${t.accountType ?? ""} ${t.loanType ?? ""}`.toLowerCase();
  if (/mortgage|real ?estate|heloc|home equity/.test(text)) return "mortgage";
  if (/revolv|credit ?card|charge ?account|open/.test(text)) return "revolving";
  return "installment";
}

function slug(s: string, i: number) {
  return `${s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "account"}-${i}`;
}

export function normalizeCrsReport(report: CrsReport): NormalizedCredit {
  const debts: Debt[] = [];
  const skipped: NormalizedCredit["skipped"] = [];

  (report.tradelines ?? []).forEach((t, i) => {
    const creditor = t.creditorName?.trim() || "Unknown creditor";
    const balance = amount(t.currentBalanceAmount);
    const kind = classify(t);
    if (t.accountClosedDate) return skipped.push({ creditor, reason: "closed" });
    if (!balance || balance <= 0) return skipped.push({ creditor, reason: "no balance" });
    // A mortgage is a fixed obligation, not something to pay down with spare cash.
    if (kind === "mortgage") return skipped.push({ creditor, reason: "mortgage" });

    const limit = kind === "revolving" ? amount(t.creditLimitAmount) ?? amount(t.highBalanceAmount) : null;
    const reportedMin = amount(t.monthlyPaymentAmount);
    // Fallback minimum: the common card formula (1% + interest ≈ 3% of balance), $25 floor.
    const minimum = reportedMin && reportedMin > 0 ? reportedMin : Math.max(25, Math.round(balance * 0.03));
    const pastDue = amount(t.pastDueAmount) ?? 0;

    debts.push({
      id: slug(creditor, i),
      label: creditor,
      kind,
      balance,
      apr: MANUAL_APR[kind],
      minimumPayment: minimum,
      dueWeeks: MANUAL_DUE_WEEKS,
      ...(limit && limit > 0 ? { creditLimit: limit } : {}),
      ...(pastDue > 0 ? { pastDue } : {}),
      sources: {
        balance: "CRS",
        apr: "manual",
        minimumPayment: reportedMin && reportedMin > 0 ? "CRS" : "manual",
        dueWeeks: "manual",
        ...(limit && limit > 0 ? { creditLimit: "CRS" as const } : {}),
      },
    });
  });

  const rawScore = report.scores?.[0];
  const score = amount(rawScore?.scoreValue);
  return { debts, skipped, score };
}
