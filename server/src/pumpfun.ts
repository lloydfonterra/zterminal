import { connect, StringCodec, type NatsConnection } from "nats.ws";
import type { AnsemCoin } from "./ansem.js";

const PUMP_COINS = "https://frontend-api-v3.pump.fun/coins";
const PUMP_SOL = "https://frontend-api-v3.pump.fun/sol-price";
const PAGE = 50;
const PUMP_SUPPLY = 1_000_000_000;
const GRADUATE_SOL = 85;
const TRADE_SUBJECT = "unifiedTradeEvent";
const NATS_UNIFIED = {
  servers: "wss://unified-prod.nats.realtime.pump.fun",
  user: "subscriber",
  pass: "OX745xvUbNQMuFqV",
};

export const pollDiag = {
  lastError: null as string | null,
  lastOkAt: 0,
  lastCount: 0,
  lastVia: null as string | null,
  nats: "down" as "down" | "live",
  tradesPerSec: 0,
  natsMsgs: 0,
};

export interface PumpTrade {
  mint: string;
  priceUsd: number;
  marketCapUsd: number;
  isBondingCurve: boolean;
  curvePct: number;
}

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
  virtual_sol_reserves?: number;
  twitter?: string;
  telegram?: string;
  website?: string;
}

export async function fetchSolPrice(): Promise<number | null> {
  const res = await fetch(PUMP_SOL, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`pump.fun sol-price HTTP ${res.status}`);
  const body = (await res.json()) as { solPrice?: number };
  const price = Number(body.solPrice);
  return price > 0 ? price : null;
}

export async function fetchPumpPage(
  offset: number,
  sort: "created_timestamp" | "last_trade_timestamp" = "created_timestamp",
): Promise<AnsemCoin[]> {
  const url = new URL(PUMP_COINS);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(PAGE));
  url.searchParams.set("sort", sort);
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

export async function fetchPumpCoin(mint: string): Promise<AnsemCoin | null> {
  const res = await fetch(`${PUMP_COINS}/${encodeURIComponent(mint)}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`pump.fun coin HTTP ${res.status}`);
  const body = (await res.json()) as PumpCoin;
  return mapPumpCoin(body);
}

export function listenPumpTrades(onTrade: (trade: PumpTrade) => void): () => void {
  let stopped = false;
  let nc: NatsConnection | null = null;
  let tradeWindow = 0;
  let tradeWindowAt = Date.now();

  const run = async (): Promise<void> => {
    while (!stopped) {
      try {
        nc = await connect({
          servers: NATS_UNIFIED.servers,
          user: NATS_UNIFIED.user,
          pass: NATS_UNIFIED.pass,
          timeout: 8_000,
          maxReconnectAttempts: -1,
          reconnectTimeWait: 1_000,
        });
        pollDiag.nats = "live";
        pollDiag.lastVia = "pump-nats";
        pollDiag.lastError = null;
        console.log("[server] pump.fun nats live");
        const sc = StringCodec();
        const sub = nc.subscribe(TRADE_SUBJECT);
        for await (const msg of sub) {
          if (stopped) break;
          pollDiag.natsMsgs += 1;
          const trade = mapTrade(sc.decode(msg.data));
          if (!trade) continue;
          tradeWindow += 1;
          const now = Date.now();
          if (now - tradeWindowAt >= 1_000) {
            pollDiag.tradesPerSec = tradeWindow;
            pollDiag.lastOkAt = now;
            tradeWindow = 0;
            tradeWindowAt = now;
          }
          onTrade(trade);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pollDiag.nats = "down";
        pollDiag.lastError = message;
        console.error("[server] pump.fun nats:", message);
      } finally {
        pollDiag.nats = "down";
        try {
          await nc?.close();
        } catch {
          /* ignore */
        }
        nc = null;
      }
      if (!stopped) await sleep(1_000);
    }
  };

  void run();
  return () => {
    stopped = true;
    void nc?.close();
  };
}

function mapTrade(raw: string): PumpTrade | null {
  const body = decodeJson(raw);
  if (!body) return null;
  const mint = String(body.mintAddress ?? "");
  if (!mint) return null;
  const cap = Number(body.marketCapUsd ?? body.marketCap);
  if (!(cap > 0)) return null;
  const price = Number(body.priceUsd);
  return {
    mint,
    marketCapUsd: cap,
    priceUsd: price > 0 ? price : cap / PUMP_SUPPLY,
    isBondingCurve: body.isBondingCurve === true,
    curvePct: body.isBondingCurve === true ? curvePctFromRealSol(realSolFromTrade(body)) : 100,
  };
}

export function curvePctFromRealSol(realSol: number): number {
  if (!(realSol > 0)) return 0;
  return Math.min(99.9, Math.round((realSol / GRADUATE_SOL) * 1000) / 10);
}

function realSolFromTrade(body: Record<string, unknown>): number {
  const quote = Number(body.quoteReserves);
  if (Number.isFinite(quote) && quote >= 0) return quote;
  const virtualSol = Number(body.virtualSolReserves ?? body.virtualQuoteReserves);
  if (Number.isFinite(virtualSol) && virtualSol > 0) return Math.max(0, virtualSol - 30);
  return 0;
}

function realSolFromCoin(raw: PumpCoin): number {
  const real = Number(raw.real_sol_reserves);
  if (Number.isFinite(real) && real > 0) return real > 1_000 ? real / 1e9 : real;
  const virtualSol = Number(raw.virtual_sol_reserves);
  if (Number.isFinite(virtualSol) && virtualSol > 0) {
    const sol = virtualSol > 1_000 ? virtualSol / 1e9 : virtualSol;
    return Math.max(0, sol - 30);
  }
  return 0;
}

function decodeJson(raw: string): Record<string, unknown> | null {
  try {
    let value: unknown = JSON.parse(raw);
    if (typeof value === "string") value = JSON.parse(value);
    if (!value || typeof value !== "object") return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanLink(raw: string | undefined, kind: "twitter" | "telegram" | "website"): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;

  if (kind === "twitter" && !text.includes("/") && !text.includes(".")) {
    const handle = text.replace(/^@/, "");
    if (/^[A-Za-z0-9_]{1,15}$/.test(handle)) return `https://x.com/${handle}`;
    return null;
  }
  if (kind === "telegram" && !text.startsWith("http://") && !text.startsWith("https://")) {
    const handle = text.replace(/^@/, "").replace(/^(?:t\.me|telegram\.me)\//i, "");
    if (/^[A-Za-z0-9_]{5,32}$/.test(handle)) return `https://t.me/${handle}`;
    return null;
  }

  if (!text.startsWith("http://") && !text.startsWith("https://")) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (!host || host === "https" || host === "http") return null;
  if (kind === "twitter") {
    if (host !== "x.com" && host !== "twitter.com") return null;
    if (url.pathname === "/" || url.pathname.startsWith("/search")) return null;
  }
  if (kind === "telegram") {
    if (host !== "t.me" && host !== "telegram.me") return null;
    if (url.pathname === "/" || url.pathname === "") return null;
  }
  if (kind === "website") {
    if (text === "https://" || text === "http://") return null;
    if (host === "pump.fun" || host === "x.com" || host === "twitter.com" || host === "t.me") return null;
  }
  return url.toString();
}

function mapPumpCoin(raw: PumpCoin): AnsemCoin | null {
  if (!raw.mint || raw.is_banned) return null;
  const createdMs = Number(raw.created_timestamp);
  if (!Number.isFinite(createdMs) || createdMs <= 0) return null;

  const cap = Number(raw.usd_market_cap ?? raw.market_cap_usd);
  if (!(cap > 0)) return null;

  const createdAt = createdMs < 1e12 ? createdMs * 1000 : createdMs;
  const graduated = raw.complete === true;
  const curvePct = graduated ? 100 : curvePctFromRealSol(realSolFromCoin(raw));

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
    twitter: cleanLink(raw.twitter, "twitter"),
    telegram: cleanLink(raw.telegram, "telegram"),
    website: cleanLink(raw.website, "website"),
    enhancedAt: null,
    createdAt: new Date(createdAt).toISOString(),
  };
}
