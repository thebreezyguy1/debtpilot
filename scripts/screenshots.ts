// Gallery screenshots for Devpost (3:2, dark theme) from the real, running app.
//   npx tsx scripts/screenshots.ts   → demo-video/images/1-plan.png … 5-proof.png
import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";

const URL = process.env.DEMO_URL ?? "http://localhost:3100";
const OUT = "demo-video/images";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function agentIdle(page: Page) {
  await pause(1500);
  await page.waitForFunction(() => !document.body.innerText.includes("Agent working"), null, { timeout: 120_000 });
  await pause(800);
}

/** Scroll so the element's top sits a little below the viewport top. */
async function scrollTo(page: Page, selector: string, offset = 24) {
  await page.locator(selector).first().evaluate((el, off) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - off }), offset);
  await pause(400);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 1 });
  await context.addInitScript(() => {
    try {
      localStorage.setItem("debtpilot-theme", "dark");
    } catch {}
  });
  const page = await context.newPage();
  await page.goto(URL);
  // Hide the Next.js dev badge; it isn't part of the product.
  await page.addStyleTag({ content: "nextjs-portal{display:none !important}" });

  await page.getByRole("button", { name: "Reset demo" }).click();
  await agentIdle(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await pause(400);
  await page.screenshot({ path: `${OUT}/1-plan.png` });

  await page.locator("#happened-input").fill("I lost my delivery gig for 3 weeks");
  await page.getByRole("button", { name: "Tell DebtPilot" }).click();
  // Claude reads the text first, then the agent run starts: wait for the result, not just "idle".
  await page.getByText(/^Applied ·/).waitFor({ timeout: 120_000 });
  await agentIdle(page);
  await page.locator("section.panel.approve").waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await pause(400);
  await page.screenshot({ path: `${OUT}/2-what-happened.png` });

  await scrollTo(page, 'section.tile:has(.label:text-is("Safe extra payment today"))');
  await page.screenshot({ path: `${OUT}/3-approval.png` });

  await page.getByRole("button", { name: /^Approve/ }).click();
  await page.locator("section.panel.approve").waitFor({ state: "detached" });
  await page.getByRole("button", { name: /Run 26-week comparison|Re-run comparison/ }).click();
  await page.getByRole("button", { name: "Simulate credit outage" }).click();
  await page.locator(".safe-mode").waitFor({ timeout: 120_000 });
  await agentIdle(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await pause(400);
  await page.screenshot({ path: `${OUT}/4-safe-mode.png` });

  await page.getByRole("button", { name: "Restore credit feed" }).click();
  await page.locator(".safe-mode").waitFor({ state: "detached", timeout: 120_000 });
  await agentIdle(page);
  await page.waitForFunction(() => document.body.innerText.includes("Re-run comparison"), null, { timeout: 120_000 });
  await scrollTo(page, 'section.panel:has(h2:text-is("DebtPilot vs. the usual advice"))');
  await page.screenshot({ path: `${OUT}/5-proof.png` });

  await browser.close();
  console.log("saved 5 screenshots to", OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
