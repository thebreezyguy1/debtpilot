"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../convex/_generated/api";
import { availableCashToday } from "../lib/planner";
import type { CandidateResult, Comparison, PlannerResult } from "../lib/planner/types";
import { CashChart, FrontierChart, StrategyChart } from "./charts";
import type { BacktestResult } from "../lib/planner/backtest";

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
const time = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const dotColor = { data: "#4fb3bf", event: "#f2a541", planner: "#7fd0d9", agent: "#e6edf3", tool: "#8b949e", human: "#7fd0d9" } as const;

/** Convex wraps server errors; show just the message. */
function errorText(err: unknown): string {
  if (!(err instanceof Error)) return "Something went wrong";
  return err.message.replace(/^[\s\S]*?Uncaught Error: /, "").split("\n")[0] ?? err.message;
}

const eventExamples = ["I lost my delivery gig for 3 weeks", "Card B raised my APR to 29.99%", "Vet bill, $400", "My shifts got cut in half for 2 weeks"];

const suggestions = ["Why not pay more this week?", "What if I also have a $400 vet bill?", "Is this real data?"];

function Logo() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="none" stroke="#4fb3bf" strokeWidth="2.5" />
      <path d="M16 6 L16 16 L23 20" fill="none" stroke="#f2a541" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function CompareCard({ title, c, rec }: { title: string; c: CandidateResult; rec?: boolean }) {
  return (
    <div className={rec ? "cmp rec" : "cmp"}>
      <span className="label" style={rec ? { color: "#7fd0d9" } : undefined}>{title}</span>
      <span className="amt">Pay {usd(c.extraPayment)}</span>
      <span className="note">
        Miss risk <strong className="mono" style={rec ? undefined : { color: "#f2a541" }}>{pct(c.missProbability)}</strong> · Expected cost{" "}
        <strong className="mono">{usd(c.expectedCost)}</strong>
      </span>
      <span className="fine">
        interest {usd(c.expectedInterest)} · fees {usd(c.expectedFees)} · penalty APR {usd(c.expectedPenaltyTail)}
      </span>
    </div>
  );
}

/** Headline written from the results, so it never claims more than the numbers show. */
function backtestHeadline(r: BacktestResult): string {
  const dp = r.policies.find((p) => p.kind === "debtpilot")!;
  const fixed = r.policies.filter((p) => p.kind === "avalanche");
  const cheapestFixed = [...fixed].sort((a, b) => a.expectedCost - b.expectedCost)[0];
  const others = r.policies.filter((p) => p.kind !== "debtpilot");
  const cheapest = others.every((p) => dp.expectedCost <= p.expectedCost);
  const parts: string[] = [];
  if (cheapest) parts.push(`DebtPilot had the lowest expected cost of all ${r.policies.length} strategies (${usd(dp.expectedCost)}).`);
  else parts.push(`DebtPilot's expected cost was ${usd(dp.expectedCost)}.`);
  if (cheapestFixed) {
    const diff = cheapestFixed.expectedCost - dp.expectedCost;
    parts.push(
      `The best fixed rule here, "${cheapestFixed.label}", ${diff >= 0 ? `cost ${usd(diff)} more` : `cost ${usd(-diff)} less`} with a ${pct(cheapestFixed.missProbability)} chance of a missed payment vs. DebtPilot's ${pct(dp.missProbability)}, and you'd have to know that buffer in advance.`,
    );
  }
  return parts.join(" ");
}

function BacktestPanel({
  backtest,
  onRun,
}: {
  backtest: { status: string; result?: unknown; error?: string; stale: boolean; scenario: string; durationMs?: number } | null;
  onRun: () => void;
}) {
  const running = backtest?.status === "running";
  const result = backtest?.status === "done" ? (backtest.result as BacktestResult) : undefined;
  return (
    <section className="panel">
      <div className="toolbar">
        <h2 style={{ color: "var(--text)" }}>DebtPilot vs. the usual advice</h2>
        <button className="btn" disabled={running} onClick={onRun}>
          {running ? "Simulating 26 weeks…" : result ? "Re-run comparison" : "Run 26-week comparison"}
        </button>
      </div>
      {!backtest && (
        <p className="note" style={{ margin: 0 }}>
          Runs each strategy through the same 200 simulated half-years of income and compares missed payments and cost.
          Takes about 15 seconds.
        </p>
      )}
      {running && <p className="note" style={{ margin: 0 }}>Running every strategy through the same simulated futures…</p>}
      {backtest?.status === "error" && <p className="note" style={{ margin: 0, color: "#f2c27a" }}>{backtest.error}</p>}
      {result && (
        <>
          {backtest!.stale && <span className="badge warn" style={{ alignSelf: "flex-start" }}>Profile changed since this run: re-run to update</span>}
          <p className="note" style={{ margin: 0, lineHeight: 1.55 }}>{backtestHeadline(result)}</p>
          <StrategyChart points={result.policies} />
          <div className="table-box">
            <table>
              <thead>
                <tr><th>Strategy</th><th>Chance of a miss</th><th>Avg misses</th><th>Expected cost</th><th>Debt paid down</th></tr>
              </thead>
              <tbody>
                {result.policies.map((p) => (
                  <tr key={p.id} style={p.kind === "debtpilot" ? { background: "#10242a" } : undefined}>
                    <td className="name" title={p.description}>{p.label}</td>
                    <td>{pct(p.missProbability)}</td>
                    <td>{p.avgMisses.toFixed(1)}</td>
                    <td>{usd(p.expectedCost)}</td>
                    <td>{usd(p.meanDebtPaidDown)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="fine">
            {backtest!.scenario} · {result.options.futures} simulated futures × {result.options.weeks} weeks, same income paths for every
            strategy · decisions every {result.options.decisionEvery} weeks · cost = interest + late fees + penalty APR. DebtPilot's 5% limit
            applies to each 8-week plan, so its 26-week risk is higher than 5%.
          </p>
        </>
      )}
    </section>
  );
}

export default function Dashboard() {
  const data = useQuery(api.dashboard.get);
  const reset = useMutation(api.demo.reset);
  const shock = useMutation(api.demo.simulateShock);
  const decide = useMutation(api.demo.decide);
  const startBacktest = useMutation(api.backtest.start);
  const setOutage = useMutation(api.demo.setCreditOutage);
  const ask = useMutation(api.demo.ask);
  const [question, setQuestion] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseLabel, setExpenseLabel] = useState("");
  const importCrs = useAction(api.crs.importPersona);
  const [personaId, setPersonaId] = useState("P05");
  const [crsStatus, setCrsStatus] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const seedNessie = useAction(api.nessie.seedDemoAccount);
  const importNessie = useAction(api.nessie.importCash);
  const tellEvent = useAction(api.agent.interpretEvent);
  const [eventText, setEventText] = useState("");
  const [eventStatus, setEventStatus] = useState<{ busy: boolean; result?: string; error?: string }>({ busy: false });
  const sendEvent = async (text: string) => {
    if (!text.trim()) return;
    setEventStatus({ busy: true });
    try {
      const r = await tellEvent({ text });
      setEventStatus({
        busy: false,
        result: `${r.applied ? "Applied" : "Not applied"} · read by ${r.interpretedBy === "claude" ? "Claude" : "the rules parser"}: ${r.summary}`,
      });
      if (r.applied) setEventText("");
    } catch (err) {
      setEventStatus({ busy: false, error: errorText(err) });
    }
  };
  const [nessieStatus, setNessieStatus] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const runNessie = async (seed: boolean) => {
    setNessieStatus({ busy: true });
    try {
      if (seed) await seedNessie({});
      await importNessie({});
      setNessieStatus({ busy: false });
    } catch (err) {
      setNessieStatus({ busy: false, error: errorText(err) });
    }
  };

  if (data === undefined) return <div className="empty">Connecting to Convex…</div>;
  if (!data.input) {
    return (
      <div className="empty">
        <p>No financial profile loaded yet.</p>
        <button className="btn primary" onClick={() => reset()}>Load Maya demo</button>
      </div>
    );
  }

  const input = data.input;
  const run = data.latestRun;
  const running = run?.status === "running";
  const done = data.plan;
  const plan = done?.result as PlannerResult | undefined;
  const cmp = done?.comparison as Comparison | undefined;
  const rec = plan?.recommended;
  const labels = Object.fromEntries(input.debts.map((d) => [d.id, d.label]));
  const target = rec ? Object.keys(rec.allocation).map((id) => labels[id] ?? id).join(" + ") : "";
  const dueWeeks = [...new Set(input.debts.flatMap((d) => d.dueWeeks))].sort((a, b) => a - b);
  const cardRoom = input.debts.reduce((s, d) => s + (d.creditLimit ? Math.max(0, d.creditLimit - d.balance) : 0), 0);

  return (
    <div className="wrap">
      <header className="header">
        <div className="brand">
          <Logo />
          <div>
            <strong>DebtPilot</strong>
            <span className="sub">{data.profileName}</span>
          </div>
        </div>
        <div className="chips">
          <span className={data.creditFeed.down ? "chip chip-warn" : "chip"}>
            <span className="dot" style={data.creditFeed.down ? { background: "#f2a541" } : undefined} />
            Credit: {data.sources.credit}
            {data.creditFeed.down
              ? ` · feed DOWN (simulated) since ${time(data.creditFeed.downSince!)}`
              : data.creditFeed.lastSyncedAt
                ? ` · synced ${time(data.creditFeed.lastSyncedAt)}`
                : ""}
          </span>
          <span className="chip"><span className="dot" />Cash: {data.sources.cash}</span>
          {data.creditScore !== null && <span className="chip">Score <strong className="mono">{data.creditScore}</strong></span>}
          <span className="chip">Risk policy <strong className="mono">≤ {pct(input.riskTolerance)}</strong></span>
        </div>
      </header>

      <div className="toolbar">
        <div className="status">
          {running ? (
            <span className="badge warn">Agent working…</span>
          ) : plan?.status === "no-safe-plan" ? (
            <span className="badge warn">No safe payment</span>
          ) : (
            <span className="badge">Plan current</span>
          )}
          {done && (
            <span>
              {done.trigger} · {plan?.scenarios.toLocaleString("en-US")} simulated income paths · {input.horizonWeeks}-week horizon
            </span>
          )}
          {run?.mode && (
            <span className="chip">{run.mode === "claude" ? "Agent: Claude" : "Agent: rules fallback"}</span>
          )}
        </div>
        <div className="btns">
          <button className="btn primary" disabled={running} onClick={() => shock({ amount: 900, label: "Car repair" })}>Simulate $900 car repair</button>
          <button className="btn" disabled={running} onClick={() => setOutage({ down: !data.creditFeed.down })}>
            {data.creditFeed.down ? "Restore credit feed" : "Simulate credit outage"}
          </button>
          <button className="btn" onClick={() => reset()}>Reset demo</button>
        </div>
      </div>

      {(done?.notes?.length ?? 0) > 0 && (
        <div className="safe-mode" role="status">
          <strong>Safe mode</strong>
          {done!.notes!.map((n) => <span key={n}>{n}</span>)}
        </div>
      )}

      <form
        className="happened"
        onSubmit={(e) => {
          e.preventDefault();
          sendEvent(eventText);
        }}
      >
        <label htmlFor="happened-input" className="happened-title">What happened?</label>
        <span className="sub">Describe a change in plain words. DebtPilot turns it into an event, re-plans, and asks before changing anything.</span>
        <div className="ask-row">
          <input
            id="happened-input"
            value={eventText}
            onChange={(e) => setEventText(e.target.value)}
            placeholder="I lost my delivery gig for 3 weeks"
            maxLength={300}
          />
          <button className="btn primary" type="submit" disabled={eventStatus.busy || running || !eventText.trim()}>
            {eventStatus.busy ? "Reading…" : "Tell DebtPilot"}
          </button>
        </div>
        <div className="btns">
          {eventExamples.map((x) => (
            <button key={x} type="button" className="btn small" disabled={eventStatus.busy || running} onClick={() => sendEvent(x)}>{x}</button>
          ))}
        </div>
        {eventStatus.result && <span className="note">{eventStatus.result}</span>}
        {eventStatus.error && <span className="note" style={{ color: "#f2c27a" }}>{eventStatus.error}</span>}
        {(input.incomeChanges?.length ?? 0) > 0 && (
          <span className="sub">
            Income changes: {input.incomeChanges!.map((c) => `${c.label} (${c.multiplier === 0 ? "no income" : `${Math.round(c.multiplier * 100)}%`}, weeks ${c.fromWeek}–${c.fromWeek + c.weeks - 1})`).join("; ")}
          </span>
        )}
      </form>

      <form
        className="expense"
        onSubmit={(e) => {
          e.preventDefault();
          const amount = Number(expenseAmount);
          if (!(amount > 0)) return;
          shock({ amount, label: expenseLabel || undefined });
          setExpenseAmount("");
          setExpenseLabel("");
        }}
      >
        <span className="sub">Try your own surprise expense (paid from cash today, adds to any earlier ones):</span>
        <label className="field">
          <span>Amount ($)</span>
          <input
            inputMode="decimal"
            type="number"
            min="1"
            max="50000"
            step="1"
            value={expenseAmount}
            onChange={(e) => setExpenseAmount(e.target.value)}
            placeholder="400"
          />
        </label>
        <label className="field">
          <span>What for</span>
          <input value={expenseLabel} onChange={(e) => setExpenseLabel(e.target.value)} placeholder="Vet bill" maxLength={60} />
        </label>
        <button className="btn" type="submit" disabled={running || !(Number(expenseAmount) > 0)}>Add expense</button>
        {input.shock && <span className="sub">So far: {input.shock.label} · {usd(input.shock.amount)}</span>}
      </form>

      {rec && plan && (
        <div className="row">
          <section className="panel tile">
            <span className="label">Safe extra payment today</span>
            <span className="big">{usd(rec.extraPayment)}</span>
            <span className="note">{rec.extraPayment > 0 ? `→ ${target}` : "Hold cash: no payment fits your risk limit"}</span>
          </section>
          <section className="panel tile">
            <span className="label">Chance of missing a payment</span>
            <span style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span className="big risk">{pct(rec.missProbability)}</span>
              <span className="sub">±{pct(rec.missStdError)} · limit {pct(plan.riskTolerance)}</span>
            </span>
            <div className="bar">
              <div style={{ width: `${Math.min(100, (rec.missProbability / plan.riskTolerance) * 100)}%` }} />
            </div>
          </section>
          <section className="panel tile">
            <span className="label">Expected 8-week cost</span>
            <span className="big">{usd(rec.expectedCost)}</span>
            <span className="note">interest + expected late fees &amp; penalty APR</span>
          </section>
          <section className="panel tile">
            <span className="label">Cash available today</span>
            <span className="big">{usd(availableCashToday(input))}</span>
            <span className="note">+ {usd(cardRoom)} unused card credit</span>
          </section>
        </div>
      )}

      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="main">
          {plan && (
            <section className="panel">
              <div className="toolbar">
                <h2 style={{ color: "var(--text)" }}>Projected cash, next {input.horizonWeeks} weeks</h2>
                <div className="legend">
                  <span><span style={{ width: 16, height: 10, background: "#4fb3bf", opacity: 0.3 }} />10th–90th percentile</span>
                  <span><span style={{ width: 16, height: 3, background: "#4fb3bf" }} />median</span>
                  <span><span style={{ width: 16, borderTop: "2px dashed #f2a541" }} />$0</span>
                </div>
              </div>
              <CashChart bands={plan.cashBands} dueWeeks={dueWeeks} />
            </section>
          )}

          {cmp && rec && (
            <section className="panel">
              <h2>Why not pay {usd(cmp.b.extraPayment)}?</h2>
              <div className="row" style={{ gap: 12 }}>
                <CompareCard title={plan?.status === "no-safe-plan" ? "Lowest risk available" : "Recommended"} c={cmp.a} rec />
                <CompareCard title={done?.comparisonLabel ?? "Alternative"} c={cmp.b} />
              </div>
              <p className="note" style={{ margin: 0, lineHeight: 1.55 }}>
                {cmp.deltaExpectedInterest < 0
                  ? `Paying ${usd(cmp.b.extraPayment)} saves ${usd(-cmp.deltaExpectedInterest)} of interest, but raises miss risk to ${pct(cmp.b.missProbability)}. `
                  : `Paying ${usd(cmp.b.extraPayment)} costs ${usd(cmp.deltaExpectedInterest)} more interest and changes miss risk to ${pct(cmp.b.missProbability)}. `}
                {cmp.deltaExpectedCost > 0
                  ? `Counting late fees and penalty APR, it costs ${usd(cmp.deltaExpectedCost)} more in expectation.`
                  : `Its expected cost is ${usd(-cmp.deltaExpectedCost)} lower, but it breaks the ${pct(input.riskTolerance)} risk limit.`}
              </p>
              <p className="fine">Both options scored on the same {plan?.scenarios.toLocaleString("en-US")} simulated income paths.</p>
            </section>
          )}

          <BacktestPanel backtest={data.backtest} onRun={() => startBacktest({})} />

          {plan && rec && (
            <section className="panel">
              <h2>Every payment the planner tried</h2>
              <FrontierChart frontier={plan.frontier} recommended={rec.extraPayment} limit={plan.riskTolerance} />
              <p className="fine">Bar height = chance of missing a payment. Teal fits the limit, amber doesn’t, white is the pick.</p>
            </section>
          )}

          <section className="panel">
            <h2>Debts</h2>
            <div className="table-box">
              <table>
                <thead>
                  <tr><th>Account</th><th>Balance</th><th>APR</th><th>Minimum</th><th>Due weeks</th><th>Source</th></tr>
                </thead>
                <tbody>
                  {input.debts.map((d) => (
                    <tr key={d.id}>
                      <td className="name">{d.label} · {d.kind}</td>
                      <td>{usd(d.balance)}{d.creditLimit ? ` / ${usd(d.creditLimit)}` : ""}</td>
                      <td>{Number((d.apr * 100).toFixed(2))}%</td>
                      <td>{usd(d.minimumPayment)}{d.pastDue ? <span style={{ color: "#f2a541" }}> · {usd(d.pastDue)} past due</span> : null}</td>
                      <td>{d.dueWeeks.map((w) => `w${w}`).join(", ")}</td>
                      <td className="src">bal {d.sources.balance ?? "?"} · APR {d.sources.apr ?? "?"} · min {d.sources.minimumPayment ?? "?"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="side">
          {done?.approval === "pending" && rec && (
            <section className="panel approve">
              <span className="label">Approval needed</span>
              <p>{done.approvalMessage}</p>
              <div className="btns">
                <button className="btn primary" onClick={() => decide({ planId: done._id, approve: true })}>
                  {rec.extraPayment > 0 ? `Approve ${usd(rec.extraPayment)}` : "Approve hold"}
                </button>
                <button className="btn" onClick={() => decide({ planId: done._id, approve: false })}>Decline</button>
              </div>
            </section>
          )}

          <section className="panel">
            <h2>Load sponsor data</h2>
            <p className="sub" style={{ margin: 0 }}>
              Pull an Experian report for a CRS sandbox test identity. Cash history stays on the demo fixture.
            </p>
            {data.integrations.crsLocked ? (
              <p className="note" style={{ margin: 0, color: "#f2c27a" }}>{data.integrations.crsLocked}</p>
            ) : !data.integrations.crsConfigured ? (
              <p className="note" style={{ margin: 0 }}>
                Set <code>CRS_USERNAME</code> and <code>CRS_PASSWORD</code> on the Convex deployment to enable this.
              </p>
            ) : null}
            <label className="field" style={{ width: "100%" }}>
              <span>Test persona</span>
              <select value={personaId} onChange={(e) => setPersonaId(e.target.value)} className="select">
                {data.integrations.personas.map((p) => (
                  <option key={p.id} value={p.id}>{p.id} · {p.name} ({p.profile})</option>
                ))}
              </select>
            </label>
            <span className="fine">{data.integrations.personas.find((p) => p.id === personaId)?.summary}</span>
            <div className="btns">
              <button
                className="btn primary"
                disabled={crsStatus.busy || !data.integrations.crsConfigured || Boolean(data.integrations.crsLocked)}
                onClick={async () => {
                  setCrsStatus({ busy: true });
                  try {
                    await importCrs({ personaId });
                    setCrsStatus({ busy: false });
                  } catch (err) {
                    setCrsStatus({ busy: false, error: errorText(err) });
                  }
                }}
              >
                {crsStatus.busy ? "Pulling report…" : "Load from CRS sandbox"}
              </button>
            </div>
            {crsStatus.error && <p className="note" style={{ margin: 0, color: "#f2c27a" }}>{crsStatus.error}</p>}

            <div style={{ borderTop: "1px solid var(--line-soft)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <span className="sub">
                Cash history from the Capital One Nessie sandbox
                {data.integrations.nessieAccount ? ` · account ${data.integrations.nessieAccount}` : ""}.
              </span>
              {!data.integrations.nessieConfigured && (
                <p className="note" style={{ margin: 0 }}>Set <code>NESSIE_API_KEY</code> on the Convex deployment to enable this.</p>
              )}
              <div className="btns">
                <button className="btn" disabled={nessieStatus.busy || !data.integrations.nessieConfigured} onClick={() => runNessie(true)}>
                  {nessieStatus.busy ? "Talking to Nessie…" : "Create demo account + import"}
                </button>
                {data.integrations.nessieAccount && (
                  <button className="btn" disabled={nessieStatus.busy} onClick={() => runNessie(false)}>Re-import cash</button>
                )}
              </div>
              {nessieStatus.error && <p className="note" style={{ margin: 0, color: "#f2c27a" }}>{nessieStatus.error}</p>}
            </div>
          </section>

          <section className="panel">
            <h2>Ask DebtPilot</h2>
            <form
              className="ask"
              onSubmit={(e) => {
                e.preventDefault();
                if (!question.trim()) return;
                ask({ question });
                setQuestion("");
              }}
            >
              <label htmlFor="ask-input" className="sub">Ask about your plan. Answers use the same planner tools.</label>
              <div className="ask-row">
                <input
                  id="ask-input"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Why didn’t you pay the 24% card?"
                  maxLength={500}
                />
                <button className="btn primary" type="submit" disabled={!question.trim()}>Ask</button>
              </div>
              <div className="btns">
                {suggestions.map((s) => (
                  <button key={s} type="button" className="btn small" onClick={() => ask({ question: s })}>{s}</button>
                ))}
              </div>
            </form>
            {data.questions.map((q) => (
              <div className="qa" key={q._id}>
                <strong>{q.question}</strong>
                {q.status === "thinking" ? (
                  <span className="sub">Thinking…</span>
                ) : (
                  <>
                    <p>{q.answer}</p>
                    <span className="fine">
                      {q.mode === "claude" ? "Claude" : "Rules fallback"} · tools: {(q.toolsUsed ?? []).join(", ") || "none"}
                    </span>
                  </>
                )}
              </div>
            ))}
          </section>

          <section className="panel">
            <h2>Agent audit log</h2>
            <div className="log">
              {data.audit.map((a) => (
                <div className="log-item" key={a._id}>
                  <span className="t">{time(a._creationTime)}</span>
                  <span className="d" style={{ background: dotColor[a.kind] }} />
                  <div>
                    <strong>{a.title}</strong>
                    <span className="x">{a.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <footer className="footer">
        Planning simulation only. Estimates, not guarantees. All data is synthetic demo data.
      </footer>
    </div>
  );
}
