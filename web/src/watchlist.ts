const KEY = "zterminal.watch";
export const WATCH_MAX = 24;

export function loadWatch(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const row of raw) {
      if (typeof row !== "string") continue;
      const mint = row.trim();
      if (!isMint(mint) || seen.has(mint)) continue;
      seen.add(mint);
      out.push(mint);
      if (out.length >= WATCH_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function saveWatch(mints: string[]): void {
  localStorage.setItem(KEY, JSON.stringify(mints.slice(0, WATCH_MAX)));
}

export function toggleWatchMint(mints: string[], mint: string): string[] {
  const key = mint.trim();
  if (!isMint(key)) return mints;
  if (mints.includes(key)) return mints.filter((m) => m !== key);
  return [key, ...mints.filter((m) => m !== key)].slice(0, WATCH_MAX);
}

function isMint(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}
