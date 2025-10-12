let lastStart = 0;
let inFlight = 0;

const maxConcurrency = Math.max(
  1,
  Number(process.env.VERTEX_MAX_CONCURRENCY ?? 2)
);
const minIntervalMs = Math.max(
  0,
  Number(process.env.VERTEX_MIN_INTERVAL_MS ?? 150)
);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withAiRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  // Wait for concurrency slot
  while (inFlight >= maxConcurrency) {
    await sleep(10);
  }
  inFlight += 1;
  try {
    // Enforce minimal interval between request starts
    const now = Date.now();
    const wait = Math.max(0, minIntervalMs - (now - lastStart));
    if (wait > 0) await sleep(wait);
    lastStart = Date.now();
    return await fn();
  } finally {
    inFlight -= 1;
  }
}

export const aiLimiterConfig = {
  get maxConcurrency() {
    return maxConcurrency;
  },
  get minIntervalMs() {
    return minIntervalMs;
  },
};
