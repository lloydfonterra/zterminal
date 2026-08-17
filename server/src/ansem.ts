import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Impit } from "impit";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);

export type CoinStatus = "on_curve" | "migrated" | string;
export type CoinTier = "free" | "gold" | "diamond" | string;

export interface AnsemCoin {
  slug: string;
  name: string;
  ticker: string;
  description: string | null;
  imageUrl: string | null;
  tier: CoinTier;
  mint: string;
  creatorWallet: string;
  teamPct: number | null;
  airdropPct: number | null;
  status: CoinStatus;
  priceUsd: number | null;
  marketCapUsd: number | null;
  curvePct: number | null;
  airdropTotal: number | null;
  pairAddress: string | null;
  volume24hUsd: number | null;
  change24hPct: number | null;
  txns24h: number | null;
  enhancedAt: string | null;
  createdAt: string;
}

interface CoinsResponse {
  coins: AnsemCoin[];
  total?: number;
}

interface MarketQuote {
  priceUsd: number;
  marketCapUsd: number;
  change24hPct: number;
  solUsd: number;
  updatedAt: string;
}

interface MarketResponse {
  quote: MarketQuote;
}

export const pollDiag = {
  lastError: null as string | null,
  lastOkAt: 0,
  lastCount: 0,
  lastVia: null as string | null,
};

const impersonated = new Impit({ browser: "chrome" });

function parseJson<T>(raw: string, via: string): T {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    throw new Error(`${via} returned non-JSON (${trimmed.slice(0, 80)})`);
  }
  return JSON.parse(trimmed) as T;
}

async function getJsonViaImpit<T>(url: string): Promise<T> {
  const res = await impersonated.fetch(url, {
    headers: {
      accept: "application/json",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`impit HTTP ${res.status}: ${body.slice(0, 80)}`);
  return parseJson<T>(body, "impit");
}

async function getJsonViaCurl<T>(url: string): Promise<T> {
  const bin = process.platform === "win32" ? "curl.exe" : "curl";
  const { stdout } = await execFileAsync(
    bin,
    [
      "-sS",
      "-f",
      "--compressed",
      "--max-time",
      "20",
      "-A",
      config.userAgent,
      "-H",
      "Accept: application/json",
      "-H",
      "Accept-Language: en-US,en;q=0.9",
      url,
    ],
    { encoding: "utf8", maxBuffer: 12 * 1024 * 1024, windowsHide: true },
  );
  return parseJson<T>(stdout, "curl");
}

/**
 * Cloudflare challenges datacenter TLS fingerprints (Railway) and bare curl.
 * Chrome-impersonated fetch first; system curl with a browser UA as fallback
 * (that still works from residential IPs).
 */
async function getJson<T>(path: string): Promise<T> {
  const url = `${config.ansemApiBase}${path}`;
  const errors: string[] = [];
  try {
    const data = await getJsonViaImpit<T>(url);
    pollDiag.lastVia = "impit";
    return data;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  try {
    const data = await getJsonViaCurl<T>(url);
    pollDiag.lastVia = "curl";
    return data;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    throw new Error(errors.join(" | "));
  }
}

export async function fetchCoins(): Promise<AnsemCoin[]> {
  const body = await getJson<CoinsResponse>("/api/coins");
  return Array.isArray(body.coins) ? body.coins : [];
}

export async function fetchMarket(): Promise<MarketQuote | null> {
  try {
    const body = await getJson<MarketResponse>("/api/market/ansem");
    return body.quote ?? null;
  } catch {
    return null;
  }
}
