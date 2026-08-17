import { execFile } from "node:child_process";
import { promisify } from "node:util";
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

/**
 * Cloudflare challenges Node's TLS fingerprint on ansem.io (HTTP 403).
 * System curl is accepted, same pattern hoodmap used for GMGN image CDNs.
 */
async function getJson<T>(path: string): Promise<T> {
  const url = `${config.ansemApiBase}${path}`;
  const bin = process.platform === "win32" ? "curl.exe" : "curl";
  const { stdout } = await execFileAsync(
    bin,
    [
      "-sS",
      "-f",
      "--max-time",
      "20",
      "-A",
      config.userAgent,
      "-H",
      "Accept: application/json",
      url,
    ],
    { encoding: "utf8", maxBuffer: 12 * 1024 * 1024, windowsHide: true },
  );
  return JSON.parse(stdout) as T;
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
