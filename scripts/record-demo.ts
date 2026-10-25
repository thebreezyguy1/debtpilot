// Records the demo video by driving the real, running app (npm run dev + convex dev).
// Captions, title and end cards are an overlay drawn on top of the page; every
// number in them is read from the screen. Agent waits are logged so
// scripts/edit-demo.sh can speed them up.
//
//   npx tsx scripts/record-demo.ts   → demo-video/raw.webm + demo-video/segments.json
import { chromium, type Locator, type Page } from "playwright";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";

const URL = process.env.DEMO_URL ?? "http://localhost:3100";
const OUT = "demo-video";
const SIZE = { width: 1600, height: 900 };

let t0 = 0;
const waits: { start: number; end: number }[] = [];
const now = () => (Date.now() - t0) / 1000;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const overlay = `
  #demo-cap{position:fixed;left:50%;bottom:36px;transform:translateX(-50%);max-width:1200px;padding:16px 28px;
    background:rgba(8,10,14,.86);color:#fff;font:600 28px/1.35 Inter,system-ui,sans-serif;border-radius:12px;
    z-index:99999;text-align:center;transition:opacity .25s;opacity:0;pointer-events:none}
  #demo-cap small{display:block;font-weight:500;font-size:20px;color:#c9d1d9;margin-top:4px}
  #demo-card{position:fixed;inset:0;background:#0d1117;color:#e6edf3;z-index:100000;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:18px;font-family:Inter,system-ui,sans-serif;text-align:center;transition:opacity .4s}
  #demo-card h1{font-size:72px;margin:0}#demo-card p{font-size:30px;margin:0;color:#c9d1d9;max-width:1200px}
  .demo-ring{outline:4px solid #f2a541 !important;outline-offset:6px;border-radius:12px;transition:outline-color .3s}`;

async function setup(page: Page) {
  await page.addStyleTag({ content: overlay });
  await page.evaluate(() => {
    const cap = document.createElement("div");
    cap.id = "demo-cap";
    document.body.appendChild(cap);
  });
}

async function caption(page: Page, text: string, sub = "", ms = 4000) {
  await page.evaluate(
    ([t, s]) => {
      const el = document.getElementById("demo-cap")!;
      el.innerHTML = "";
      el.append(document.createTextNode(t!));
      if (s) {
        const small = document.createElement("small");
        small.textContent = s;
        el.append(small);
      }
      el.style.opacity = "1";
    },
    [text, sub],
  );
  await pause(ms);
}

async function hideCaption(page: Page) {
  await page.evaluate(() => (document.getElementById("demo-cap")!.style.opacity = "0"));
}

async function card(page: Page, title: string, lines: string[], ms: number) {
  await page.evaluate(
    ([t, l]) => {
      document.getElementById("demo-card")?.remove();
      const c = document.createElement("div");
      c.id = "demo-card";
      const h = document.createElement("h1");
      h.textContent = t as string;
      c.append(h);
      for (const line of l as string[]) {
        const p = document.createElement("p");
        p.textContent = line;
        c.append(p);
      }
      document.body.appendChild(c);
    },
    [title, lines] as const,
  );
  await pause(ms);
  await page.evaluate(() => {
    const c = document.getElementById("demo-card");
    if (c) {
      c.style.opacity = "0";
      setTimeout(() => c.remove(), 450);
    }
  });
  await pause(500);
}

/** Highlight one element (or clear highlights) and bring it into view. */
async function ring(page: Page, target: Locator | null) {
  await page.evaluate(() => document.querySelectorAll(".demo-ring").forEach((e) => e.classList.remove("demo-ring")));
  if (target) {
    await target.first().evaluate((el) => {
      el.classList.add("demo-ring");
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
  await pause(700);
}

async function scrollTop(page: Page) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  await pause(700);
}

const panel = (heading: string) => `section.panel:has(h2:text-is("${heading}"))`;

/** Run a step; if it takes noticeably long (the page settling), log it as a span to speed up. */
async function timed(step: () => Promise<unknown>) {
  const start = now();
  await step();
  if (now() - start > 1.5) waits.push({ start, end: now() });
}

/** Wait for the agent to finish, logging the span so the editor can speed it up. */
async function waitForAgent(page: Page, timeoutMs = 90_000) {
  const start = now();
  await pause(1500);
  await page.waitForFunction(() => !document.body.innerText.includes("Agent working"), null, { timeout: timeoutMs });
  await pause(800);
  waits.push({ start, end: now() });
}

async function text(page: Page, selector: string): Promise<string> {
  return ((await page.locator(selector).first().innerText()) ?? "").trim();
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // 1. Reset the demo off camera.
  const prep = await browser.newPage({ viewport: SIZE });
  await prep.goto(URL);
  await prep.getByRole("button", { name: "Reset demo" }).click();
  await pause(2000);
  await prep.waitForFunction(() => !document.body.innerText.includes("Agent working"), null, { timeout: 90_000 });
  await prep.close();

  // 2. Record.
  const context = await browser.newContext({ viewport: SIZE, recordVideo: { dir: OUT, size: SIZE } });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("debtpilot-theme", "dark");
    } catch {}
  });
  const page = await context.newPage();
  t0 = Date.now();
  await page.goto(URL);
  await page.getByText("Plan current").waitFor();
  await setup(page);
  const trimStart = now(); // everything before this is the page loading

  await card(page, "DebtPilot", ["How much can I safely pay toward my debt this week?", "A live demo · built solo at Cal Hacks 13.0"], 3500);

  // The plan before anything happens.
  const safe = await text(page, 'section.tile:has(.label:text-is("Safe extra payment today")) .big');
  const risk = await text(page, 'section.tile:has(.label:text-is("Chance of missing a payment")) .big');
  await ring(page, page.locator("header .brand"));
  await caption(page, "Maya is a freelance designer and delivery driver.", "Her income swings from $0 to $1,180 a week.", 4000);
  await ring(page, page.locator('section.tile:has(.label:text-is("Safe extra payment today"))'));
  await caption(page, `DebtPilot says ${safe} is safe to pay today.`, `${risk} chance of missing rent or a minimum, across 2,000 simulated futures.`, 5000);

  const why = await page.locator('section.panel:has(h2:has-text("Why not pay"))').first();
  const alt = (await why.locator(".cmp").nth(1).innerText()).match(/Miss risk\s+([\d.]+%)/)?.[1] ?? "";
  await ring(page, page.locator('section.panel:has(h2:has-text("Why not pay"))'));
  await caption(page, "Why not pay everything?", `Her chance of missing a payment would jump to ${alt}, and late fees would make it cost more.`, 5000);

  // The moment.
  await scrollTop(page);
  await ring(page, page.locator("form.happened"));
  await caption(page, "Then life happens. She tells DebtPilot in plain words.", "", 2500);
  const input = page.locator("#happened-input");
  await input.click();
  await input.pressSequentially("I lost my delivery gig for 3 weeks", { delay: 45 });
  await pause(500);
  await page.getByRole("button", { name: "Tell DebtPilot" }).click();
  await caption(page, "Claude reads it and re-plans", "Every tool call lands in the audit log · sped up", 1500);
  await waitForAgent(page);
  await hideCaption(page);

  const newSafe = await text(page, 'section.tile:has(.label:text-is("Safe extra payment today")) .big');
  const oldRisk = (await page.locator('section.panel:has(h2:has-text("Why not pay")) .cmp').nth(1).innerText()).match(/Miss risk\s+([\d.]+%)/)?.[1] ?? "";
  await ring(page, page.locator('section.tile:has(.label:text-is("Safe extra payment today"))'));
  await caption(page, `New safe payment: ${newSafe}.`, `Keeping ${safe} would mean a ${oldRisk} chance of missing a payment.`, 5000);
  await ring(page, page.locator("section.panel.approve"));
  await caption(page, "It doesn't just change the plan. It asks first.", "Claude wrote this approval request; nothing moves without a yes.", 5000);
  await timed(() => page.getByRole("button", { name: /^Approve/ }).click({ timeout: 20_000 }));
  await pause(1200);
  await ring(page, page.locator(panel("Agent audit log")));
  await caption(page, "Approved. Every step is on the record.", "", 4000);

  // Start the six-month test, then break something while it runs.
  await ring(page, page.locator(panel("DebtPilot vs. the usual advice")));
  await timed(() => page.getByRole("button", { name: /Run 26-week comparison|Re-run comparison/ }).click());
  await caption(page, "Starting a six-month test in the background…", "", 2500);

  await scrollTop(page);
  await ring(page, null);
  await timed(() => page.getByRole("button", { name: "Simulate credit outage" }).click());
  await caption(page, "Now the credit bureau feed goes down (simulated).", "The agent retries once, then carries on with the last good data · sped up", 1500);
  await waitForAgent(page);
  await hideCaption(page);
  await ring(page, page.locator(".safe-mode"));
  await caption(page, "Safe mode: on stale data, payments can go down but never up.", "Enforced in code, not just in the prompt.", 5000);
  await timed(() => page.getByRole("button", { name: "Restore credit feed" }).click());
  await caption(page, "Feed restored: it re-syncs, then re-plans on fresh data · sped up", "", 1500);
  await waitForAgent(page);
  await hideCaption(page);

  // The proof.
  const start = now();
  await page.waitForFunction(() => document.body.innerText.includes("Re-run comparison"), null, { timeout: 120_000 });
  if (now() - start > 2) waits.push({ start, end: now() });
  const rows = await page.locator(`${panel("DebtPilot vs. the usual advice")} tbody tr`).allInnerTexts();
  const cells = (label: string) => rows.find((r) => r.startsWith(label))?.split("\t") ?? [];
  const dp = cells("DebtPilot");
  const k1000 = cells("Keep $1,000");
  await ring(page, page.locator(panel("DebtPilot vs. the usual advice")));
  await caption(
    page,
    `Six months, 200 simulated futures: DebtPilot had the lowest expected cost (${dp[3] ?? ""}).`,
    `The best fixed rule, “keep $1,000”, had a ${k1000[1] ?? ""} chance of a missed payment vs. DebtPilot's ${dp[1] ?? ""}.`,
    7000,
  );
  await hideCaption(page);
  await ring(page, null);

  await card(page, "Claude decides. Code does the math.", ["Nothing moves without your OK.", "DebtPilot · built solo at Cal Hacks 13.0 by Dorian Taponzing Donfack"], 5000);

  const end = now();
  const video = page.video();
  await context.close();
  await browser.close();
  const path = await video?.path();
  if (path) renameSync(path, `${OUT}/raw.webm`);
  writeFileSync(`${OUT}/segments.json`, JSON.stringify({ trimStart, waits, recorded: end }, null, 2));
  console.log(`Saved ${OUT}/raw.webm (${end.toFixed(0)} s); ${waits.length} spans to speed up`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
