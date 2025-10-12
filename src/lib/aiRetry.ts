/* Centralized retry with exponential backoff and jitter for transient Vertex AI/API errors */

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

export function isTransientVertexError(err: unknown): boolean {
  const msg = String((err as Error)?.message || err || "");
  return /(429|RESOURCE_EXHAUSTED|Too Many Requests|UNAVAILABLE|ECONNRESET|ETIMEDOUT)/i.test(
    msg
  );
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: { retries?: number; baseDelayMs?: number; maxDelayMs?: number }
): Promise<T> {
  const retries = options?.retries ?? 3;
  const base = options?.baseDelayMs ?? 800;
  const max = options?.maxDelayMs ?? 8000;
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      attempt++;
      if (!isTransientVertexError(e) || attempt > retries) throw e;
      const backoff = Math.min(
        max,
        Math.round(base * Math.pow(2, attempt - 1))
      );
      const jitter = Math.round(backoff * (0.8 + Math.random() * 0.4));
      console.warn(
        `[AI] Transient error, retrying in ${jitter}ms (attempt ${attempt}/${retries})`
      );
      await sleep(jitter);
    }
  }
}
