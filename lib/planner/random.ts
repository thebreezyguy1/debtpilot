// Seeded PRNG so a demo run is reproducible and every candidate payment is
// scored on the exact same income futures (common random numbers).
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Circular block bootstrap: resample runs of consecutive weeks rather than
 * single weeks, so a zero-income week followed by a weak week stays together.
 */
export function generateIncomePaths(
  history: number[],
  horizonWeeks: number,
  count: number,
  blockLength: number,
  seed: number,
): number[][] {
  if (history.length === 0) throw new Error("Income history is empty");
  const rng = mulberry32(seed);
  const n = history.length;
  const block = Math.max(1, Math.min(blockLength, n));
  const paths: number[][] = [];
  for (let s = 0; s < count; s++) {
    const path: number[] = [];
    while (path.length < horizonWeeks) {
      const start = Math.floor(rng() * n);
      for (let k = 0; k < block && path.length < horizonWeeks; k++) {
        path.push(history[(start + k) % n]!);
      }
    }
    paths.push(path);
  }
  return paths;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx]!;
}
