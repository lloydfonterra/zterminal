import type { AnsemCoin } from "./ansem.js";

/** Wire format sent to the browser. Mirrored in web/src/types.ts. */
export interface WireToken {
  /** Same as mint — one bubble per ansem.io coin. */
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
  priceUsd: number;
  marketCapUsd: number;
  /** Fractional price change over the trailing 5 minutes. 0.25 means +25%. */
  change5m: number;
  /** API 24h change as a fraction. */
  change24h: number;
  volumeUsd24h: number;
  txns24h: number;
}

interface PricePoint {
  t: number;
  p: number;
}

interface Pool {
  coin: AnsemCoin;
  createdAt: number;
  lastTradeAt: number;
  history: PricePoint[];
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export class MarketState {
  private pools = new Map<string, Pool>();
  private dirty = new Set<string>();
  private created = new Set<string>();
  private removed = new Set<string>();

  solPriceUsd = 0;
  ansemPriceUsd = 0;

  applyCoins(coins: AnsemCoin[], now: number): void {
    const seen = new Set<string>();

    for (const coin of coins) {
      if (!coin.mint) continue;
      const createdAt = Date.parse(coin.createdAt);
      if (!Number.isFinite(createdAt)) continue;

      const price = Number(coin.priceUsd);
      const cap = Number(coin.marketCapUsd);
      if (!(cap > 0) || !Number.isFinite(cap)) continue;

      seen.add(coin.mint);
      const prev = this.pools.get(coin.mint);

      if (!prev) {
        this.pools.set(coin.mint, {
          coin,
          createdAt,
          lastTradeAt: createdAt,
          history: Number.isFinite(price) && price > 0 ? [{ t: now, p: price }] : [],
        });
        this.created.add(coin.mint);
        continue;
      }

      const moved =
        prev.coin.marketCapUsd !== coin.marketCapUsd ||
        prev.coin.priceUsd !== coin.priceUsd ||
        prev.coin.status !== coin.status ||
        prev.coin.tier !== coin.tier ||
        prev.coin.curvePct !== coin.curvePct ||
        prev.coin.volume24hUsd !== coin.volume24hUsd ||
        prev.coin.change24hPct !== coin.change24hPct;

      if (moved) {
        if (prev.coin.marketCapUsd !== coin.marketCapUsd || prev.coin.priceUsd !== coin.priceUsd) {
          prev.lastTradeAt = now;
          if (Number.isFinite(price) && price > 0) prev.history.push({ t: now, p: price });
        }
        prev.coin = coin;
        this.dirty.add(coin.mint);
      }
    }

    for (const mint of this.pools.keys()) {
      if (seen.has(mint)) continue;
      this.pools.delete(mint);
      this.created.delete(mint);
      this.dirty.delete(mint);
      this.removed.add(mint);
    }

    this.trimHistory(now);
  }

  imageUrlFor(mint: string): string | null {
    const url = this.pools.get(mint)?.coin.imageUrl;
    return url && url.startsWith("http") ? url : null;
  }

  private trimHistory(now: number): void {
    const historyStart = now - FIVE_MINUTES_MS;
    for (const pool of this.pools.values()) {
      if (pool.history.length <= 2) continue;
      const keepFrom = pool.history.findLastIndex((h) => h.t < historyStart);
      if (keepFrom > 0) pool.history = pool.history.slice(keepFrom);
    }
  }

  private toWire(pool: Pool): WireToken {
    const coin = pool.coin;
    const price = Number(coin.priceUsd) || 0;
    const cap = Number(coin.marketCapUsd) || 0;
    const oldest = pool.history[0];
    const change5m =
      oldest && oldest.p > 0 && pool.history.length > 1 ? price / oldest.p - 1 : 0;
    const change24h = Number(coin.change24hPct);
    return {
      poolId: coin.mint,
      token: coin.mint,
      symbol: coin.ticker || "?",
      name: coin.name || coin.ticker || "?",
      slug: coin.slug,
      tier: coin.tier || "free",
      status: coin.status || "on_curve",
      curvePct: Number(coin.curvePct) || 0,
      createdAt: pool.createdAt,
      lastTradeAt: pool.lastTradeAt,
      priceUsd: price,
      marketCapUsd: cap,
      change5m: Number.isFinite(change5m) ? change5m : 0,
      change24h: Number.isFinite(change24h) ? change24h / 100 : 0,
      volumeUsd24h: Number(coin.volume24hUsd) || 0,
      txns24h: Number(coin.txns24h) || 0,
    };
  }

  snapshot(): {
    payloadType: "snapshot";
    solPriceUsd: number;
    ansemPriceUsd: number;
    new: WireToken[];
  } {
    return {
      payloadType: "snapshot",
      solPriceUsd: this.solPriceUsd,
      ansemPriceUsd: this.ansemPriceUsd,
      new: [...this.pools.values()].map((p) => this.toWire(p)),
    };
  }

  drainDelta(): {
    payloadType: "delta";
    solPriceUsd: number;
    ansemPriceUsd: number;
    new: WireToken[];
    updated: WireToken[];
    removed: string[];
  } | null {
    const created: WireToken[] = [];
    const updated: WireToken[] = [];

    for (const mint of this.created) {
      const pool = this.pools.get(mint);
      if (pool) created.push(this.toWire(pool));
    }
    for (const mint of this.dirty) {
      if (this.created.has(mint)) continue;
      const pool = this.pools.get(mint);
      if (pool) updated.push(this.toWire(pool));
    }

    const removed = [...this.removed];
    this.created.clear();
    this.dirty.clear();
    this.removed.clear();

    if (created.length === 0 && updated.length === 0 && removed.length === 0) return null;
    return {
      payloadType: "delta",
      solPriceUsd: this.solPriceUsd,
      ansemPriceUsd: this.ansemPriceUsd,
      new: created,
      updated,
      removed,
    };
  }

  get stats(): { live: number; onCurve: number; migrated: number } {
    let onCurve = 0;
    let migrated = 0;
    for (const pool of this.pools.values()) {
      if (pool.coin.status === "migrated") migrated += 1;
      else onCurve += 1;
    }
    return { live: this.pools.size, onCurve, migrated };
  }
}
