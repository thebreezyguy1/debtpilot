import type { Debt, Expense, PathOutcome, PlannerInput, Shock } from "./types";

export type DebtState = {
  debt: Debt;
  balance: number;
  penalty: boolean;
};

export type PathState = {
  cash: number;
  debts: DebtState[];
  missed: boolean;
  /** Number of required payments missed (rent, bills or minimums). */
  misses: number;
  interest: number;
  fees: number;
};

/** Decides whether something scheduled on `weeks` is due in `week`. */
export type DueRule = (weeks: number[] | "weekly", week: number) => boolean;

/** Planner horizon: due weeks are listed explicitly. */
const listedWeeks: DueRule = (weeks, week) => weeks === "weekly" || weeks.includes(week);

export function effectiveApr(d: DebtState, input: PlannerInput): number {
  return d.penalty ? Math.max(d.debt.apr, input.fees.penaltyApr) : d.debt.apr;
}

/** Charge to the cheapest card with available credit. Returns the amount that didn't fit. */
function chargeToCards(state: PathState, amount: number, input: PlannerInput): number {
  const cards = state.debts
    .filter((d) => d.debt.kind === "revolving" && d.debt.creditLimit !== undefined)
    .sort((x, y) => effectiveApr(x, input) - effectiveApr(y, input));
  let remaining = amount;
  for (const card of cards) {
    if (remaining <= 0) break;
    const room = Math.max(0, card.debt.creditLimit! - card.balance);
    const charge = Math.min(room, remaining);
    card.balance += charge;
    remaining -= charge;
  }
  return remaining;
}

function spend(state: PathState, amount: number, payWith: Expense["payWith"], input: PlannerInput): void {
  if (payWith === "cash") {
    if (state.cash >= amount) {
      state.cash -= amount;
    } else {
      state.cash = 0;
      state.missed = true;
      state.misses++;
      state.fees += input.fees.essentialLateFee;
    }
    return;
  }
  const fromCash = Math.min(Math.max(state.cash, 0), amount);
  state.cash -= fromCash;
  const unpaid = chargeToCards(state, amount - fromCash, input);
  if (unpaid > 0.005) {
    state.missed = true;
    state.misses++;
    state.fees += input.fees.essentialLateFee;
  }
}

export function applyShock(state: PathState, shock: Shock | undefined, week: number, input: PlannerInput): void {
  if (shock && shock.week === week) spend(state, shock.amount, shock.payWith, input);
}

/** Combined effect of all income changes active in a given week. */
export function incomeMultiplier(input: PlannerInput, week: number): number {
  let m = 1;
  for (const c of input.incomeChanges ?? []) {
    if (week >= c.fromWeek && week < c.fromWeek + c.weeks) m *= Math.max(0, c.multiplier);
  }
  return m;
}

/** Cash left after a week-0 shock: the most that could be paid toward debt today. */
export function availableCashToday(input: PlannerInput): number {
  const shock = input.shock;
  if (shock && shock.week === 0 && shock.payWith === "cash") {
    return Math.max(0, input.cashBalance - shock.amount);
  }
  return input.cashBalance;
}

export function newPathState(input: PlannerInput): PathState {
  return {
    cash: input.cashBalance,
    debts: input.debts.map((debt) => ({ debt, balance: debt.balance, penalty: false })),
    missed: false,
    misses: 0,
    interest: 0,
    fees: 0,
  };
}

/** Pay extra amounts toward debts now, limited by balance and cash on hand. */
export function payExtra(state: PathState, allocation: Record<string, number>): void {
  for (const d of state.debts) {
    const pay = Math.min(allocation[d.debt.id] ?? 0, d.balance, Math.max(state.cash, 0));
    d.balance -= pay;
    state.cash -= pay;
  }
}

/**
 * One week of cash flow. Order reflects what a careful household does:
 * cash-only bills first, then debt minimums, then spending that can go on a
 * card (cash first, card if cash runs out).
 */
export function stepWeek(state: PathState, input: PlannerInput, week: number, income: number, isDue: DueRule): void {
  for (const d of state.debts) {
    const i = (d.balance * effectiveApr(d, input)) / 52;
    d.balance += i;
    state.interest += i;
  }
  state.cash += income * incomeMultiplier(input, week);
  applyShock(state, input.shock, week, input);

  for (const e of input.expenses) {
    if (e.payWith === "cash" && isDue(e.weeks, week)) spend(state, e.amount, "cash", input);
  }

  for (const d of state.debts) {
    if (!isDue(d.debt.dueWeeks, week) || d.balance <= 0) continue;
    const due = Math.min(d.debt.minimumPayment, d.balance);
    if (state.cash >= due) {
      state.cash -= due;
      d.balance -= due;
    } else {
      state.missed = true;
      state.misses++;
      state.fees += input.fees.lateFee;
      d.balance += input.fees.lateFee;
      if (d.debt.kind === "revolving") d.penalty = true;
    }
  }

  for (const e of input.expenses) {
    if (e.payWith === "cash-or-card" && isDue(e.weeks, week)) spend(state, e.amount, "cash-or-card", input);
  }
}

/** Extra interest a penalty APR keeps costing after the simulated period ends. */
export function penaltyTail(state: PathState, input: PlannerInput): number {
  let tail = 0;
  for (const d of state.debts) {
    if (d.penalty) tail += (d.balance * (effectiveApr(d, input) - d.debt.apr) * input.fees.penaltyTailWeeks) / 52;
  }
  return tail;
}

/** Simulate one income future over the planner horizon after paying `allocation` today. */
export function simulatePath(
  input: PlannerInput,
  allocation: Record<string, number>,
  income: number[],
): PathOutcome {
  const state = newPathState(input);
  applyShock(state, input.shock, 0, input);
  payExtra(state, allocation);

  const cashByWeek: number[] = [state.cash];
  for (let week = 1; week <= input.horizonWeeks; week++) {
    stepWeek(state, input, week, income[week - 1] ?? 0, listedWeeks);
    cashByWeek.push(state.cash);
  }

  return {
    missed: state.missed,
    interest: state.interest,
    fees: state.fees,
    penaltyTail: penaltyTail(state, input),
    endingCash: state.cash,
    endingDebt: state.debts.reduce((sum, d) => sum + d.balance, 0),
    cashByWeek,
  };
}
