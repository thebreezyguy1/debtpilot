// CRS Standard Format → DebtPilot Debt[]. The one place that knows CRS field
// names; a CRS change touches this file, not the engine, agent or UI.
import type { Debt } from "../planner/types";

/** The subset of a CRS Standard Format tradeline we read (all amounts are strings). */
export type CrsTradeline = {
  accountIdentifier?: string;
  accountType?: string;
  loanType?: string;
  businessType?: string;
  currentRatingType?: string;
  creditorName?: string;
  accountOpenedDate?: string;
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
  collections: { label: string; balance: number; source: "CRS" }[];
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

function classify(t: CrsTradeline): "revolving" | "installment" | "mortgage" | "collection" {
  const text = `${t.accountType ?? ""} ${t.loanType ?? ""}`.toLowerCase();
  // Collections arrive as accountType "Open"; the loan type, business type and rating say what they are.
  if (/collection/.test(`${t.loanType ?? ""} ${t.businessType ?? ""} ${t.currentRatingType ?? ""}`.toLowerCase())) return "collection";
  if (/mortgage|real ?estate|heloc|home equity/.test(text)) return "mortgage";
  if (/revolv|credit ?card|charge ?account/.test(text)) return "revolving";
  return "installment";
}

function slug(s: string, i: number) {
  return `${s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "account"}-${i}`;
}

export function normalizeCrsReport(report: CrsReport): NormalizedCredit {
  const debts: Debt[] = [];
  const collections: NormalizedCredit["collections"] = [];
  const skipped: NormalizedCredit["skipped"] = [];
  const tradelines = report.tradelines ?? [];
  // Real reports hold several accounts with one creditor name; tell them apart by open year.
  const nameCount = new Map<string, number>();
  for (const t of tradelines) {
    const n = t.creditorName?.trim() || "Unknown creditor";
    nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
  }
  const seenIds = new Set<string>();

  tradelines.forEach((t, i) => {
    const creditor = t.creditorName?.trim() || "Unknown creditor";
    const accountId = t.accountIdentifier?.trim();
    if (accountId && seenIds.has(accountId)) return skipped.push({ creditor, reason: "duplicate entry" });
    if (accountId) seenIds.add(accountId);
    const balance = amount(t.currentBalanceAmount);
    const kind = classify(t);
    if (t.accountClosedDate) return skipped.push({ creditor, reason: "closed" });
    if (!balance || balance <= 0) return skipped.push({ creditor, reason: "no balance" });
    // A mortgage is a fixed obligation, not something to pay down with spare cash.
    if (kind === "mortgage") return skipped.push({ creditor, reason: "mortgage" });
    // A collection has no limit, minimum or card APR; a counselor negotiates it outside the plan.
    if (kind === "collection") return collections.push({ label: creditor, balance, source: "CRS" });

    // Only a reported limit counts: a high balance is not room to borrow.
    const limit = kind === "revolving" ? amount(t.creditLimitAmount) : null;
    const reportedMin = amount(t.monthlyPaymentAmount);
    // Fallback minimum: the common card formula (1% + interest ≈ 3% of balance), $25 floor.
    const minimum = reportedMin && reportedMin > 0 ? reportedMin : Math.max(25, Math.round(balance * 0.03));
    const pastDue = amount(t.pastDueAmount) ?? 0;

    const opened = t.accountOpenedDate?.slice(0, 4);
    const label = (nameCount.get(creditor) ?? 0) > 1 && opened ? `${creditor} (opened ${opened})` : creditor;

    debts.push({
      id: accountId ? slug(accountId, i) : slug(creditor, i),
      label,
      kind,
      balance,
      apr: MANUAL_APR[kind],
      minimumPayment: minimum,
      dueWeeks: MANUAL_DUE_WEEKS,
      ...(limit && limit > 0 ? { creditLimit: limit } : {}),
      ...(pastDue > 0 ? { pastDue } : {}),
      ...(t.currentRatingType ? { status: t.currentRatingType } : {}),
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
  return { debts, collections, skipped, score };
}
