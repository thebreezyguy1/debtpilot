// "What happened?" events: free text → a typed event → a new PlannerInput.
// Claude (or the rules parser) only proposes the event; applyEvent validates
// and clamps it before anything reaches the planner.
import { z } from "zod";
import type { PlannerInput } from "../planner/types";

export const FinanceEventSchema = z.object({
  kind: z.enum(["expense", "income_change", "apr_change", "not_a_financial_event"]),
  label: z.string().describe("Short name for the event, e.g. 'Lost delivery gig' or 'Vet bill'"),
  amount: z.number().describe("expense: dollars paid today. Otherwise 0."),
  weeks: z.number().describe("income_change: how many weeks it lasts (1-8). Otherwise 0."),
  income_multiplier: z
    .number()
    .describe("income_change: fraction of normal income during those weeks (0 = none, 0.5 = half). Otherwise 1."),
  debt_label: z.string().describe("apr_change: label of the affected debt, copied from the list. Otherwise empty."),
  new_apr_pct: z.number().describe("apr_change: the new APR in percent, e.g. 29.99. Otherwise 0."),
  explanation: z.string().describe("One sentence: how you read the user's message."),
});

export type FinanceEvent = z.infer<typeof FinanceEventSchema>;

export function interpreterPrompt(input: PlannerInput): string {
  const debts = input.debts.map((d) => `- ${d.label} (${d.kind}, ${(d.apr * 100).toFixed(1)}% APR)`).join("\n");
  const sources = (input.incomeSources ?? []).map((x) => `- ${x.label}: about ${Math.round(x.share * 100)}% of income`).join("\n");
  return `Turn the user's description of something that happened to their finances into one event for a debt planner.

Event kinds:
- expense: a one-time cost already paid from cash today (repair, medical bill, fine).
- income_change: their income drops (or rises) for a number of weeks (lost gig, sick, fewer shifts). Use income_multiplier for the fraction of normal income; 0 means no income.
- apr_change: the interest rate on one debt changes. Pick the debt from this list; if none is named, pick the credit card with the highest APR.
- not_a_financial_event: anything else, including questions.

The user's debts:
${debts}
${sources ? `\nThe user's income sources (if they lose one, income_multiplier is the share left from the others):\n${sources}\n` : ""}
Fill every field; use the "Otherwise" defaults for fields that don't apply.`;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Validate, clamp and apply an event. Returns null for not_a_financial_event. */
export function applyEvent(input: PlannerInput, e: FinanceEvent): { input: PlannerInput; summary: string } | null {
  const label = e.label.trim().slice(0, 60) || "Event";
  if (e.kind === "expense") {
    const amount = Math.round(clamp(e.amount, 0, 50_000));
    if (amount <= 0) return null;
    const prior = input.shock?.week === 0 ? input.shock : undefined;
    return {
      input: {
        ...input,
        shock: {
          label: prior ? `${prior.label} + ${label}` : label,
          amount: (prior?.amount ?? 0) + amount,
          week: 0,
          payWith: "cash",
        },
      },
      summary: `${label}: $${amount.toLocaleString("en-US")} paid from cash today`,
    };
  }
  if (e.kind === "income_change") {
    const weeks = Math.round(clamp(e.weeks || 1, 1, input.horizonWeeks));
    const multiplier = clamp(e.income_multiplier, 0, 2);
    const change = { label, fromWeek: 1, weeks, multiplier };
    const effect = multiplier === 0 ? "no income" : `${Math.round(multiplier * 100)}% of normal income`;
    return {
      input: { ...input, incomeChanges: [...(input.incomeChanges ?? []), change] },
      summary: `${label}: ${effect} for the next ${weeks} week${weeks === 1 ? "" : "s"}`,
    };
  }
  if (e.kind === "apr_change") {
    const apr = clamp(e.new_apr_pct, 0, 60) / 100;
    const wanted = e.debt_label.trim().toLowerCase();
    const byLabel = input.debts.find((d) => wanted && d.label.toLowerCase() === wanted)
      ?? input.debts.find((d) => wanted && (d.label.toLowerCase().includes(wanted) || wanted.includes(d.label.toLowerCase())));
    const target = byLabel ?? [...input.debts].filter((d) => d.kind === "revolving").sort((a, b) => b.apr - a.apr)[0];
    if (!target || apr <= 0) return null;
    const old = target.apr;
    return {
      input: {
        ...input,
        debts: input.debts.map((d) => (d.id === target.id ? { ...d, apr, sources: { ...d.sources, apr: "event" } } : d)),
      },
      summary: `${target.label} APR ${Number((old * 100).toFixed(2))}% → ${Number((apr * 100).toFixed(2))}%`,
    };
  }
  return null;
}

const WORD_NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

/** Deterministic fallback when Claude isn't available. Handles the common phrasings. */
export function rulesInterpret(text: string, input: PlannerInput): FinanceEvent {
  const t = text.toLowerCase();
  const none = { amount: 0, weeks: 0, income_multiplier: 1, debt_label: "", new_apr_pct: 0 };
  const label = text.trim().replace(/[.!?]+$/, "").slice(0, 40);

  const apr = t.match(/(?:apr|interest|rate)[^\d%]{0,40}?(\d+(?:\.\d+)?)\s*%/) ?? t.match(/(\d+(?:\.\d+)?)\s*%\s*(?:apr|interest)/);
  if (apr) {
    const named = input.debts.find((d) => t.includes(d.label.toLowerCase()));
    return { ...none, kind: "apr_change", label: "Rate change", new_apr_pct: Number(apr[1]), debt_label: named?.label ?? "", explanation: "Read as an interest rate change (rules parser)." };
  }

  const weeksMatch = t.match(/(\d+|a|an|one|two|three|four|five|six|seven|eight)\s*(?:weeks?|wks?)/);
  const months = /\bmonth\b/.test(t) ? 4 : 0;
  const weeks = weeksMatch ? (Number(weeksMatch[1]) || WORD_NUMBERS[weeksMatch[1]!] || 1) : months;
  const incomeWords = /(lost|lose|laid off|fired|no (?:work|gigs?|shifts?|income)|fewer|cut|reduced|half|sick|paused|slow)/;
  if (incomeWords.test(t) && (weeks > 0 || !/\$/.test(t))) {
    const pctCut = t.match(/(\d+)\s*%\s*(?:less|cut|drop|fewer)/);
    const lostSource = (input.incomeSources ?? []).find((src) =>
      src.label.toLowerCase().split(/\s+/).some((w) => w.length > 3 && t.includes(w.replace(/ing$/, ""))),
    );
    const multiplier = /half/.test(t) ? 0.5 : pctCut ? 1 - Number(pctCut[1]) / 100 : lostSource ? 1 - lostSource.share : 0;
    return { ...none, kind: "income_change", label: label || "Income drop", weeks: weeks || 2, income_multiplier: multiplier, explanation: "Read as an income drop (rules parser)." };
  }

  const dollars = t.match(/\$\s?([\d,]+(?:\.\d+)?)/) ?? t.match(/([\d,]+)\s*(?:dollars|bucks)/);
  if (dollars) {
    return { ...none, kind: "expense", label: label || "Expense", amount: Number(dollars[1]!.replace(/,/g, "")), explanation: "Read as a one-time expense (rules parser)." };
  }
  return { ...none, kind: "not_a_financial_event", label: "", explanation: "Couldn't find an amount, rate or income change (rules parser)." };
}
