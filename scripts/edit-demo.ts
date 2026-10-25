// Edits demo-video/raw.webm into the final 1080p video: drops the page-load
// frames, plays the logged waits (agent thinking) at 4x, and re-encodes in the
// browser (no ffmpeg needed). Run after scripts/record-demo.ts.
//
//   npx tsx scripts/edit-demo.ts   → demo-video/DebtPilot-demo.mp4 (or .webm)
import { chromium } from "playwright";
import { appendFileSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve("demo-video");
const SPEED = 4;
const seg = JSON.parse(readFileSync(`${DIR}/segments.json`, "utf8")) as {
  trimStart: number;
  waits: { start: number; end: number }[];
  recorded: number;
};

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  // Serve the raw file from one origin so the canvas isn't treated as cross-origin.
  await page.route("http://demo.local/**", (route) =>
    route.request().url().endsWith("/raw.webm")
      ? route.fulfill({ path: `${DIR}/raw.webm`, contentType: "video/webm" })
      : route.fulfill({ body: "<!doctype html><body style='margin:0;background:#000'></body>", contentType: "text/html" }),
  );
  // tsx keeps function names with an `__name` helper that doesn't exist in the page.
  await page.addInitScript("window.__name = (f) => f");
  await page.goto("http://demo.local/");

  const mime = await page.evaluate(() =>
    ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m))!,
  );
  const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
  const out = `${DIR}/DebtPilot-demo.${ext}`;
  rmSync(out, { force: true });
  await page.exposeFunction("saveChunk", (b64: string) => appendFileSync(out, Buffer.from(b64, "base64")));

  const seconds = await page.evaluate(
    async ({ mime, seg, speed }) => {
      const v = document.createElement("video");
      v.src = "/raw.webm";
      v.muted = true;
      document.body.append(v);
      await new Promise((r) => (v.onloadeddata = r));

      const c = document.createElement("canvas");
      c.width = 1920;
      c.height = 1080;
      const g = c.getContext("2d")!;
      const rec = new MediaRecorder(c.captureStream(30), { mimeType: mime, videoBitsPerSecond: 10_000_000 });
      const pending: Promise<void>[] = [];
      rec.ondataavailable = (e) => {
        pending.push(
          e.data.arrayBuffer().then((buf) => {
            let s = "";
            const bytes = new Uint8Array(buf);
            for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            return (window as unknown as { saveChunk: (b: string) => Promise<void> }).saveChunk(btoa(s));
          }),
        );
      };

      v.currentTime = seg.trimStart;
      await new Promise((r) => (v.onseeked = r));
      const fast = (t: number) => seg.waits.some((w) => t >= w.start + 0.5 && t <= w.end - 0.5);
      const startedAt = performance.now();
      const done = new Promise<void>((resolveDone) => {
        const draw = () => {
          g.drawImage(v, 0, 0, c.width, c.height);
          v.playbackRate = fast(v.currentTime) ? speed : 1;
          if (v.ended || v.currentTime >= seg.recorded - 0.1) {
            v.pause();
            resolveDone();
            return;
          }
          v.requestVideoFrameCallback(draw);
        };
        v.requestVideoFrameCallback(draw);
      });
      g.drawImage(v, 0, 0, c.width, c.height);
      rec.start(1000);
      await v.play();
      await done;
      await new Promise((r) => setTimeout(r, 300));
      const stopped = new Promise((r) => (rec.onstop = r));
      rec.stop();
      await stopped;
      await Promise.all(pending);
      return (performance.now() - startedAt) / 1000;
    },
    { mime, seg, speed: SPEED },
  );

  await browser.close();
  console.log(`Saved ${out} (${seconds.toFixed(0)} s, ${mime})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
