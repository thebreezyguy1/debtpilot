import type { CandidateResult, CashBand } from "../lib/planner/types";

const W = 640;
const H = 230;
const L = 52;
const R = 620;
const TOP = 20;
const BOTTOM = 196;

const usdShort = (n: number) => (Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`);

export function CashChart({ bands, dueWeeks }: { bands: CashBand[]; dueWeeks: number[] }) {
  const max = Math.max(...bands.map((b) => b.p90), 500);
  const min = Math.min(...bands.map((b) => b.p10), 0);
  const y = (v: number) => BOTTOM - ((v - min) / (max - min)) * (BOTTOM - TOP);
  const weeks = bands.length - 1;
  const x = (w: number) => L + (w / weeks) * (R - L);
  const band =
    bands.map((b) => `${x(b.week)},${y(b.p90)}`).join(" ") +
    " " +
    [...bands].reverse().map((b) => `${x(b.week)},${y(b.p10)}`).join(" ");
  const median = bands.map((b) => `${x(b.week)},${y(b.p50)}`).join(" ");
  const ticks = [0, max / 2, max];
  const worst = Math.min(...bands.map((b) => b.p10));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      role="img"
      aria-label={`Projected cash: lowest 10th-percentile balance is ${usdShort(worst)}`}
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={R} y1={y(t)} y2={y(t)} stroke="var(--line)" />
          <text x={L - 8} y={y(t) + 4} fontSize="11" fill="var(--muted)" textAnchor="end" fontFamily="var(--mono)">
            {usdShort(t)}
          </text>
        </g>
      ))}
      {dueWeeks.map((w) => (
        <g key={w}>
          <line x1={x(w)} x2={x(w)} y1={TOP - 6} y2={BOTTOM} stroke="var(--muted)" strokeDasharray="2 4" />
          <text x={x(w)} y={10} fontSize="11" fill="var(--muted)" textAnchor="middle">
            minimums due
          </text>
        </g>
      ))}
      <polygon points={band} fill="var(--safe)" fillOpacity={0.22} />
      <polyline points={median} fill="none" stroke="var(--safe)" strokeWidth={2.5} />
      <line x1={L} x2={R} y1={y(0)} y2={y(0)} stroke="var(--risk)" strokeWidth={2} strokeDasharray="6 5" />
      {bands.map((b) => (
        <text key={b.week} x={x(b.week)} y={H - 8} fontSize="11" fill="var(--muted)" textAnchor="middle" fontFamily="var(--mono)">
          {b.week === 0 ? "now" : `w${b.week}`}
        </text>
      ))}
    </svg>
  );
}

/** Miss probability for every candidate payment: the risk side of the search. */
export function FrontierChart({
  frontier,
  recommended,
  limit,
}: {
  frontier: CandidateResult[];
  recommended: number;
  limit: number;
}) {
  const maxP = Math.max(0.5, ...frontier.map((c) => c.missProbability));
  const maxPay = Math.max(...frontier.map((c) => c.extraPayment), 1);
  const x = (p: number) => L + (p / maxPay) * (R - L);
  const y = (p: number) => BOTTOM - (p / maxP) * (BOTTOM - TOP);
  const barW = Math.max(2, ((R - L) / frontier.length) * 0.7);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      role="img"
      aria-label={`Miss risk rises with payment size; recommended $${recommended}`}
    >
      {[0, maxP / 2, maxP].map((t) => (
        <g key={t}>
          <line x1={L} x2={R} y1={y(t)} y2={y(t)} stroke="var(--line)" />
          <text x={L - 8} y={y(t) + 4} fontSize="11" fill="var(--muted)" textAnchor="end" fontFamily="var(--mono)">
            {Math.round(t * 100)}%
          </text>
        </g>
      ))}
      {frontier.map((c) => (
        <rect
          key={c.extraPayment}
          x={x(c.extraPayment) - barW / 2}
          y={y(c.missProbability)}
          width={barW}
          height={Math.max(1, BOTTOM - y(c.missProbability))}
          fill={c.extraPayment === recommended ? "var(--text)" : c.feasible ? "var(--safe)" : "var(--risk)"}
          fillOpacity={c.extraPayment === recommended ? 1 : 0.75}
        />
      ))}
      <line x1={L} x2={R} y1={y(limit)} y2={y(limit)} stroke="var(--text)" strokeDasharray="4 4" />
      <text x={R} y={y(limit) - 6} fontSize="11" fill="var(--text-2)" textAnchor="end">
        your {Math.round(limit * 100)}% limit
      </text>
      {[0, maxPay / 2, maxPay].map((p) => (
        <text key={p} x={x(p)} y={H - 8} fontSize="11" fill="var(--muted)" textAnchor="middle" fontFamily="var(--mono)">
          {usdShort(p)}
        </text>
      ))}
    </svg>
  );
}

/**
 * Place each label beside its dot, moving it up 16px at a time until it
 * overlaps neither another label nor another dot.
 */
function placeLabels<T extends { px: number; py: number; p: { label: string; kind: string } }>(items: T[]): (T & { ly: number })[] {
  const span = (it: T): [number, number] => {
    const w = it.p.label.length * 6.6;
    return it.px > 440 ? [it.px - 12 - w, it.px - 12] : [it.px + 12, it.px + 12 + w];
  };
  const placed: (T & { ly: number })[] = [];
  // DebtPilot first so its label stays right next to its dot.
  const order = [...items].sort((a, b) => (a.p.kind === "debtpilot" ? -1 : b.p.kind === "debtpilot" ? 1 : a.py - b.py));
  for (const item of order) {
    const [x0, x1] = span(item);
    let ly = item.py;
    for (let tries = 0; tries < 8; tries++) {
      const hitsLabel = placed.some((o) => {
        const [o0, o1] = span(o);
        return o0 < x1 && x0 < o1 && Math.abs(o.ly - ly) < 15;
      });
      const hitsDot = items.some((o) => o !== item && o.px > x0 - 10 && o.px < x1 + 10 && Math.abs(o.py - ly) < 12);
      if (!hitsLabel && !hitsDot) break;
      ly -= 16;
    }
    placed.push({ ...item, ly });
  }
  return placed;
}

type StrategyPoint = { id: string; label: string; missProbability: number; expectedCost: number; kind: string };

/** One dot per strategy: chance of missing a payment (x) vs. expected cost (y). Lower-left is better. */
export function StrategyChart({ points }: { points: StrategyPoint[] }) {
  const maxX = Math.min(1, Math.max(0.2, ...points.map((p) => p.missProbability)) * 1.1);
  const costs = points.map((p) => p.expectedCost);
  const minY = Math.min(...costs) * 0.9;
  const maxY = Math.max(...costs) * 1.05;
  const left = 64;
  const right = 600;
  const top = 18;
  const bottom = 190;
  const x = (p: number) => left + (p / maxX) * (right - left);
  const y = (c: number) => bottom - ((c - minY) / (maxY - minY)) * (bottom - top);
  const xTicks = [0, maxX / 2, maxX];
  const yTicks = [minY, (minY + maxY) / 2, maxY];
  const dp = points.find((p) => p.kind === "debtpilot");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      role="img"
      aria-label={`Strategies by risk and cost${dp ? `; DebtPilot at ${Math.round(dp.missProbability * 100)}% risk and $${Math.round(dp.expectedCost)}` : ""}`}
    >
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={left} x2={right} y1={y(t)} y2={y(t)} stroke="var(--line)" />
          <text x={left - 8} y={y(t) + 4} fontSize="11" fill="var(--muted)" textAnchor="end" fontFamily="var(--mono)">
            ${Math.round(t)}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={`x${t}`} x={x(t)} y={bottom + 18} fontSize="11" fill="var(--muted)" textAnchor="middle" fontFamily="var(--mono)">
          {Math.round(t * 100)}%
        </text>
      ))}
      <text x={(left + right) / 2} y={H - 4} fontSize="11" fill="var(--muted)" textAnchor="middle">
        chance of missing at least one payment over 26 weeks →
      </text>
      <text x={14} y={(top + bottom) / 2} fontSize="11" fill="var(--muted)" textAnchor="middle" transform={`rotate(-90 14 ${(top + bottom) / 2})`}>
        expected cost ↑
      </text>
      {placeLabels(points.map((p) => ({ p, px: x(p.missProbability), py: y(p.expectedCost) }))).map(({ p, px, py, ly }) => {
        const isDp = p.kind === "debtpilot";
        const anchor = px > 440 ? "end" : "start";
        return (
          <g key={p.id}>
            <circle cx={px} cy={py} r={isDp ? 8 : 6} fill={isDp ? "var(--safe)" : "var(--risk)"} fillOpacity={isDp ? 1 : 0.85} stroke={isDp ? "var(--text)" : "none"} strokeWidth={2} />
            {Math.abs(ly - py) > 2 && <line x1={px} y1={py} x2={px + (anchor === "start" ? 10 : -10)} y2={ly} stroke="var(--muted)" strokeWidth={1} />}
            <text x={px + (anchor === "start" ? 12 : -12)} y={ly + 4} fontSize="12" fill={isDp ? "var(--text)" : "var(--text-2)"} textAnchor={anchor} fontWeight={isDp ? 700 : 400}>
              {p.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
