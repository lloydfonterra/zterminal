import type { AnsemCoin } from "./ansem.js";

const PUMP_COINS = "https://frontend-api-v3.pump.fun/coins";
const PAGE = 50;
const PUMP_SUPPLY = 1_000_000_000;
const GRADUATE_SOL = 85;

export const pollDiag = {
  lastError: null as string | null,
  lastOkAt: 0,
  lastCount: 0,
  lastVia: null as string | null,
};

interface PumpCoin {
  mint?: string;
  name?: string;
  symbol?: string;
  description?: string;
  image_uri?: string;
  creator?: string;
  created_timestamp?: number;
  complete?: boolean;
  is_banned?: boolean;
  usd_market_cap?: number;
  market_cap_usd?: number;
  real_sol_reserves?: number;
}

export async function fetchPumpPage(offset: number): Promise<AnsemCoin[]> {
  const url = new URL(PUMP_COINS);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(PAGE));
  url.searchParams.set("sort", "created_timestamp");
  url.searchParams.set("order", "desc");
  url.searchParams.set("includeNsfw", "true");

  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`pump.fun HTTP ${res.status}`);
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) return [];

  const out: AnsemCoin[] = [];
  for (const raw of body) {
    const coin = mapPumpCoin(raw as PumpCoin);
    if (coin) out.push(coin);
  }
  return out;
}

/** Newest pump.fun coins, walking pages until `maxAgeMs` or `maxCoins`. */
export async function fetchRecentPumpCoins(
  maxAgeMs: number,
  maxCoins: number,
): Promise<AnsemCoin[]> {
  const cutoff = Date.now() - maxAgeMs;
  const out: AnsemCoin[] = [];

  for (let offset = 0; offset < maxCoins; offset += PAGE) {
    const page = await fetchPumpPage(offset);
    if (page.length === 0) break;
    for (const coin of page) {
      if (Date.parse(coin.createdAt) < cutoff) return out;
      out.push(coin);
      if (out.length >= maxCoins) return out;
    }
    if (page.length < PAGE) break;
  }
  return out;
}

function mapPumpCoin(raw: PumpCoin): AnsemCoin | null {
  if (!raw.mint || raw.is_banned) return null;
  const createdMs = Number(raw.created_timestamp);
  if (!Number.isFinite(createdMs) || createdMs <= 0) return null;

  const cap = Number(raw.usd_market_cap ?? raw.market_cap_usd);
  if (!(cap > 0)) return null;

  const createdAt = createdMs < 1e12 ? createdMs * 1000 : createdMs;
  const graduated = raw.complete === true;
  const realSol = Number(raw.real_sol_reserves) / 1e9;
  const curvePct = graduated
    ? 100
    : Math.max(0, Math.min(99, Math.round((realSol / GRADUATE_SOL) * 100)));

  return {
    slug: (raw.symbol || raw.mint).toLowerCase(),
    name: raw.name || raw.symbol || "?",
    ticker: raw.symbol || "?",
    description: raw.description ?? null,
    imageUrl: raw.image_uri && raw.image_uri.startsWith("http") ? raw.image_uri : null,
    tier: "free",
    mint: raw.mint,
    creatorWallet: raw.creator || "",
    teamPct: null,
    airdropPct: null,
    status: graduated ? "migrated" : "on_curve",
    priceUsd: cap / PUMP_SUPPLY,
    marketCapUsd: cap,
    curvePct,
    airdropTotal: null,
    pairAddress: null,
    volume24hUsd: null,
    change24hPct: null,
    txns24h: null,
    enhancedAt: null,
    createdAt: new Date(createdAt).toISOString(),
  };
}
