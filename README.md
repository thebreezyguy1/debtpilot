# DebtPilot

A risk-aware debt autopilot for people with irregular income. It decides how much extra you can safely put toward debt today without making it likely you miss a required payment, and re-plans when income or expenses change.

## Planner engine (`lib/planner`)

Pure TypeScript, no dependencies, so it runs the same way in a Convex action, a Next.js route or a test.

- **Income model:** circular block bootstrap over weekly income history (`blockLength` weeks per block, so dry spells stay together). Seeded, so every candidate payment is scored on the same futures.
- **Weekly simulation:** interest accrues → income lands → cash-only bills (rent) → debt minimums → card-eligible spending (cash first, then re-borrowed on the cheapest card with room).
- **Miss** = any minimum or cash-only bill that can't be paid. A missed card minimum adds a late fee and a penalty APR that keeps costing money for `penaltyTailWeeks` after the horizon.
- **Search:** for each extra payment in `paymentStep` increments (allocated highest-APR first), estimate miss probability and expected cost (interest + fees + penalty tail). Among payments within `riskTolerance`, pick the lowest expected cost. If none qualify, return `status: "no-safe-plan"` and hold cash.
- `comparePlans(input, a, b)` scores any two payments on identical paths: the "why not pay more?" answer.

Claude should call these as tools and never do the arithmetic itself.

## App (Next.js + Convex)

- `convex/demo.ts`: `reset` loads the Maya fixture, `simulateShock` injects an expense, `decide` approves or declines a changed plan, `ask` queues a question. Every change to the finances starts an agent run.
- `convex/agent.ts` (Node action): the agent. `onEvent` runs on each event; `answer` handles Ask DebtPilot questions.
- `convex/agentData.ts`: the agent's only path to the database.
- `convex/dashboard.ts`: one live query; the page re-renders as soon as a plan, log entry or answer lands.

## Agent (`lib/agent/tools.ts`, `convex/agent.ts`)

Four tools, all backed by the planner engine: `get_financial_state`, `simulate_plan`, `compare_plan`, `request_approval` (event runs only). Claude (`claude-opus-5-5`, effort `medium`, server-side refusal fallback) drives a manual tool loop so every call is written to the audit log, followed by its explanation.

Guardrails live in code, not the prompt: Claude never computes numbers; if it skips `simulate_plan` the code runs it; if the plan changed and Claude didn't ask for approval, the code requests it. Nothing is "paid" until Maya approves, and payments are simulated (no payment rail).

Without `ANTHROPIC_API_KEY` on the Convex deployment, or if the API call fails, a rules-based agent runs the same tools in a fixed order, so the demo always works. The dashboard shows which one ran.

```bash
npx convex env set ANTHROPIC_API_KEY <your key>   # prefix with CONVEX_AGENT_MODE=anonymous for the local backend
```

## Run

```bash
npm install
CONVEX_AGENT_MODE=anonymous npx convex dev   # local backend on :3210, no account needed
npx next dev -p 3100                          # in a second terminal
```

Open http://localhost:3100 and click **Load Maya demo**. To deploy to Convex cloud for judging, run `npx convex login` and then `npx convex dev` without the env var.

```bash
npm run demo   # engine only: Maya before/after a $900 car repair
npm test
```

All data in `lib/planner/fixtures` is synthetic. Fields marked `manual` in `sources` are the ones we don't yet expect the CRS sandbox to provide (APR, minimum, due dates).

## "What happened?" events (`lib/agent/events.ts`)

Free text such as "I lost my delivery gig for 3 weeks", "Card B raised my APR to 29.99%" or "Vet bill, $400" becomes one typed event: `expense`, `income_change` (a share of normal income for N weeks), `apr_change`, or `not_a_financial_event`. Claude reads it with structured outputs (`betaZodOutputFormat`); without Claude, a rules parser handles the common phrasings. `applyEvent` validates and clamps every field before the profile changes, then the agent re-plans and asks for approval. The profile's `incomeSources` let "lost one gig" mean a partial drop instead of zero income.

## Strategy comparison (`lib/planner/backtest.ts`)

"Run 26-week comparison" sends DebtPilot, three fixed-buffer versions of the usual advice ("keep $500 / $1,000 / $1,500, send the rest to the highest-APR debt") and minimums-only through the same 200 simulated half-years of income, using the planner's own weekly rules (`stepWeek`). DebtPilot re-plans every 4 weeks from where each future actually is. It runs as a background Node action (~15 s) and is marked stale when the profile changes.

What it showed for the Maya fixture (honest reading):
- Normal: DebtPilot had the lowest expected cost ($437). The "keep $1,000" rule cost $10 more but missed payments less often (10% vs 16%).
- After losing the delivery gig: DebtPilot was cheapest ($542) and also safer than "keep $1,000" (19% vs 31.5%), because a fixed buffer doesn't adapt.
- DebtPilot's 5% limit applies to each 8-week plan, so its 26-week miss chance is higher than 5%. Say so if asked.

## Outage and recovery demo

**Simulate credit outage** marks the credit bureau (CRS) feed as down and triggers the agent. `get_financial_state` reports credit data as unavailable, and `refresh_credit_data` fails with a timeout, so the agent has to cope with a real error: it retries once, carries on with the last known snapshot, and explains what was unavailable. While the feed is down, code puts the planner in **safe mode**: it can lower payments but never raise them above the previous plan (`maxExtraPayment`), and the plan carries a visible caveat. **Restore credit feed** triggers a re-sync (enforced in code if the model skips it) and a normal re-plan. Reset always starts with every feed healthy. The outage is simulated and labeled as such in the UI and the log.

## Sponsor data

**CRS (credit):** `convex/crs.ts` logs in once, pulls an Experian report (`exp-prequal-vantage4`) for a provided test identity (`lib/crs/personas.ts`: P01 prime, P05 subprime, P18 rebuilding) and maps tradelines through `lib/crs/normalize.ts`. CRS supplies balance, credit limit, monthly payment, past-due amount and score. It has **no APR or due date**, so those use typical values labeled `manual` in the UI. A failed login locks further attempts (repeated failures disable the sandbox account); after fixing credentials run `npx convex run crs:unlock`.

**Nessie (cash):** `convex/nessie.ts` can create a sandbox customer and account, post the persona's weekly income as deposits, then read balance and deposits back into weekly income (`lib/nessie/normalize.ts`). The endpoint shapes follow the public Nessie API and are **not yet verified with a real key**; if they fail, the fixture cash data stays in place.

## Environment variables (set on Convex, never in `.env.local`)

| Variable | Enables |
|---|---|
| `ANTHROPIC_API_KEY` | Claude as the agent (otherwise the rules agent runs) |
| `CRS_USERNAME`, `CRS_PASSWORD` | "Load from CRS sandbox" |
| `NESSIE_API_KEY` (optional `NESSIE_BASE_URL`) | Nessie cash import |

```bash
CONVEX_AGENT_MODE=anonymous npx convex env set CRS_USERNAME you@example.com   # local backend
npx convex env set CRS_USERNAME you@example.com --prod                        # cloud deployment
```

## Deploy (for judges)

1. `npx convex login`, then `npx convex dev` once to create a cloud project (this replaces the anonymous local deployment in `.env.local`).
2. Set the variables above on the **production** deployment with `--prod`.
3. In the Convex dashboard, create a production deploy key.
4. Import the repo into Vercel. Set `CONVEX_DEPLOY_KEY` to that key, and the build command to `npx convex deploy --cmd 'npm run build'`.
5. Open the Vercel URL and click **Load Maya demo** (or load a CRS persona).

To check a production build locally without stopping `next dev`: `NEXT_DIST_DIR=.next-build npm run build`.
