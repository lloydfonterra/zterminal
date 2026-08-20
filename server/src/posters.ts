export interface PosterFamily {
  handle: string;
  count: number;
}

const mintsByHandle = new Map<string, Set<string>>();
const handlesByMint = new Map<string, Set<string>>();
const displayHandle = new Map<string, string>();

export function recordPosters(mint: string, handles: string[]): void {
  const m = mint.trim();
  if (!m || handles.length === 0) return;
  const onMint = handlesByMint.get(m) ?? new Set<string>();
  for (const raw of handles) {
    const handle = raw.replace(/^@/, "").trim();
    if (!handle) continue;
    const key = handle.toLowerCase();
    displayHandle.set(key, handle);
    onMint.add(key);
    const mints = mintsByHandle.get(key) ?? new Set<string>();
    mints.add(m);
    mintsByHandle.set(key, mints);
  }
  handlesByMint.set(m, onMint);
}

export function familyForMint(mint: string): PosterFamily | null {
  const keys = handlesByMint.get(mint.trim());
  if (!keys) return null;
  let best: PosterFamily | null = null;
  for (const key of keys) {
    const count = mintsByHandle.get(key)?.size ?? 0;
    if (count < 2) continue;
    if (!best || count > best.count) {
      best = { handle: displayHandle.get(key) || key, count };
    }
  }
  return best;
}

export function posterSnapshot(): Record<string, PosterFamily> {
  const out: Record<string, PosterFamily> = {};
  for (const mint of handlesByMint.keys()) {
    const family = familyForMint(mint);
    if (family) out[mint] = family;
  }
  return out;
}
