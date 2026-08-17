export interface DexQuote {
  mint: string;
  priceUsd: number;
  marketCapUsd: number;
  change5mPct: number | null;
  change24hPct: number | null;
  volumeUsd24h: number | null;
}

interface DexPair {
  baseToken?: { address?: string };
  priceUsd?: string;
  marketCap?: number;
  fdv?: number;
  priceChange?: { m5?: number; h24?: number };
  volume?: { h24?: number };
  liquidity?: { usd?: number };
}

const DEX_TOKENS = "https://api.dexscreener.com/tokens/v1/solana/";
const JUP_PRICE = "https://lite-api.jup.ag/price/v2?ids=";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const BATCH = 30;

export async function fetchSolUsd(): Promise<number | null> {
  try {
    const res = await fetch(`${JUP_PRICE}${SOL_MINT}`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: Record<string, { price?: string }> };
    const price = Number(body.data?.[SOL_MINT]?.price);
    return price > 0 ? price : null;
  } catch {
    return null;
  }
}

export async function fetchDexQuotes(mints: string[]): Promise<DexQuote[]> {
  const unique = [...new Set(mints.filter(Boolean))];
  const out: DexQuote[] = [];
  for (let i = 0; i < unique.length; i += BATCH) {
    const chunk = unique.slice(i, i + BATCH);
    const quotes = await fetchDexBatch(chunk);
    out.push(...quotes);
  }
  return out;
}

async function fetchDexBatch(mints: string[]): Promise<DexQuote[]> {
  const res = await fetch(`${DEX_TOKENS}${mints.join(",")}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`dexscreener HTTP ${res.status}`);
  const pairs = (await res.json()) as DexPair[];
  if (!Array.isArray(pairs)) return [];

  const byMint = new Map<string, DexPair[]>();
  for (const pair of pairs) {
    const mint = pair.baseToken?.address;
    if (!mint) continue;
    const list = byMint.get(mint) ?? [];
    list.push(pair);
    byMint.set(mint, list);
  }

  const quotes: DexQuote[] = [];
  for (const mint of mints) {
    const best = pickPair(byMint.get(mint) ?? []);
    if (!best) continue;
    const priceUsd = Number(best.priceUsd);
    const marketCapUsd = Number(best.marketCap ?? best.fdv);
    if (!(priceUsd > 0) || !(marketCapUsd > 0)) continue;
    quotes.push({
      mint,
      priceUsd,
      marketCapUsd,
      change5mPct: numOrNull(best.priceChange?.m5),
      change24hPct: numOrNull(best.priceChange?.h24),
      volumeUsd24h: numOrNull(best.volume?.h24),
    });
  }
  return quotes;
}

function pickPair(pairs: DexPair[]): DexPair | null {
  if (pairs.length === 0) return null;
  return [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0] ?? null;
}

function numOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
