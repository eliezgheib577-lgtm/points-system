/**
 * Casefold and strip accents so that "Nour Abou Jaoude", "nour abou jaoude" and
 * "Noûr  Abou-Jaoude" all collapse to one key. Used for member matching, which
 * is the difference between one member profile and three.
 */
export function normalizeName(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Token-overlap similarity in [0,1]; good enough to rank import candidates. */
export function nameSimilarity(a: string, b: string): number {
  const left = new Set(normalizeName(a).split(" ").filter(Boolean));
  const right = new Set(normalizeName(b).split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
    else for (const other of right) {
      // "L." matching "Lea": an initial counts as a weak match.
      if (token.length === 1 && other.startsWith(token)) { shared += 0.5; break; }
      if (other.length === 1 && token.startsWith(other)) { shared += 0.5; break; }
    }
  }
  return shared / Math.max(left.size, right.size);
}

export function randomToken(bytes = 32): string {
  return crypto.getRandomValues(new Uint8Array(bytes))
    .reduce((acc, byte) => acc + byte.toString(16).padStart(2, "0"), "");
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function elapsed(value: Date | string): { unit: "now" | "min" | "hour" | "day"; n: number } {
  const date = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return { unit: "now", n: 0 };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { unit: "min", n: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hour", n: hours };
  return { unit: "day", n: Math.floor(hours / 24) };
}

function amount(unit: "min" | "hour" | "day", n: number): string {
  if (unit === "min") return `${n} min`;
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** A moment: "just now", "5 min ago", "2 days ago". */
export function timeAgo(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const { unit, n } = elapsed(value);
  return unit === "now" ? "just now" : `${amount(unit, n)} ago`;
}

/** A duration: "under a minute", "5 min", "2 days" — for "waiting …". */
export function waitedFor(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const { unit, n } = elapsed(value);
  return unit === "now" ? "under a minute" : amount(unit, n);
}
