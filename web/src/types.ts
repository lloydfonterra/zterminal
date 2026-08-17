export interface Token {
  poolId: string;
  token: string;
  symbol: string;
  name: string;
  slug: string;
  tier: string;
  status: string;
  curvePct: number;
  createdAt: number;
  lastTradeAt: number;
  /** Client-only: Date.now() of the last chart tape tick. */
  liveTickAt?: number;
  priceUsd: number;
  marketCapUsd: number;
  change5m: number;
  change24h: number;
  volumeUsd24h: number;
  txns24h: number;
}

export interface Snapshot {
  payloadType: "snapshot";
  solPriceUsd: number;
  ansemPriceUsd: number;
  new: Token[];
}

export interface Delta {
  payloadType: "delta";
  solPriceUsd: number;
  ansemPriceUsd: number;
  new: Token[];
  updated: Token[];
  removed: string[];
}

export type FeedMessage = Snapshot | Delta;
