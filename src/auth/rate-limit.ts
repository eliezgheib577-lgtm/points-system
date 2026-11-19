/**
 * Sign-in throttling. Only failures count towards a limit, and a success clears
 * the username's record — otherwise a committee sharing one wifi connection
 * would lock itself out by signing in normally.
 *
 * Counters live in this process, which is fine for a single server. Behind
 * several instances this becomes per-instance and wants Redis or a table.
 */
const failures = new Map<string, number[]>();
const WINDOW_MS = 15 * 60_000;

function recent(key: string, now = Date.now()): number[] {
  const hits = (failures.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  if (hits.length === 0) failures.delete(key);
  else failures.set(key, hits);
  return hits;
}

export function isLimited(key: string, limit: number): boolean {
  return recent(key).length >= limit;
}

export function recordFailure(key: string): void {
  const hits = recent(key);
  hits.push(Date.now());
  failures.set(key, hits);
}

export function clearAttempts(key: string): void {
  failures.delete(key);
}

export function minutesUntilReset(key: string): number {
  const hits = recent(key);
  if (hits.length === 0) return 0;
  return Math.max(1, Math.ceil((WINDOW_MS - (Date.now() - Math.min(...hits))) / 60_000));
}

setInterval(() => {
  for (const key of [...failures.keys()]) recent(key);
}, WINDOW_MS).unref();
