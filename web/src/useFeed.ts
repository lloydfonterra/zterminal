import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedMessage, Token } from "./types";

export type ConnectionState = "connecting" | "live" | "reconnecting";

export interface Feed {
  tokens: Token[];
  solPriceUsd: number;
  ansemPriceUsd: number;
  status: ConnectionState;
  setWatchMints: (mints: string[]) => void;
}

const ANSEM_WS = "wss://ansem.io/market-ws/ws";
/** Ignore REST mcap/price while a live trade is this fresh. */
const LIVE_HOLD_MS = 20_000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
/** Pump.fun / PumpSwap supply — same 1e9 the ansem.io chart uses for USD mcap. */
const PUMP_SUPPLY = 1_000_000_000;
const MAX_SUBS = 80;
const KEEP_LIVE_MS = 30_000;

interface LiveTradeMessage {
  type?: string;
  mint?: string;
  data?: {
    ts?: number;
    blockTime?: number;
    priceUsd?: number | string;
    priceQuote?: number | string;
    quoteAmount?: number | string;
  };
}

export function useFeed(publishIntervalMs = 32): Feed {
  const poolsRef = useRef(new Map<string, Token>());
  const liveAtRef = useRef(new Map<string, number>());
  const priceHistRef = useRef(new Map<string, Array<{ t: number; p: number }>>());
  const watchRef = useRef<string[]>([]);
  const solRef = useRef(0);
  const ansemRef = useRef(0);
  const dirtyRef = useRef(false);

  const [tokens, setTokens] = useState<Token[]>([]);
  const [solPriceUsd, setSolPriceUsd] = useState(0);
  const [ansemPriceUsd, setAnsemPriceUsd] = useState(0);
  const [status, setStatus] = useState<ConnectionState>("connecting");

  const setWatchMints = useCallback((mints: string[]): void => {
    watchRef.current = mints;
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let closed = false;

    const mergeRest = (prev: Token | undefined, incoming: Token): Token => {
      if (!prev) return incoming;
      const liveAt = liveAtRef.current.get(incoming.poolId);
      if (liveAt && Date.now() - liveAt < LIVE_HOLD_MS) {
        return {
          ...incoming,
          priceUsd: prev.priceUsd,
          marketCapUsd: prev.marketCapUsd,
          lastTradeAt: prev.lastTradeAt,
          change5m: prev.change5m,
          liveTickAt: prev.liveTickAt,
        };
      }
      return { ...incoming, liveTickAt: prev.liveTickAt };
    };

    const connect = (): void => {
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${scheme}://${window.location.host}/ws/public`);

      socket.onopen = () => setStatus("live");

      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        if (event.data === "ping") {
          socket?.send("pong");
          return;
        }

        let message: FeedMessage;
        try {
          message = JSON.parse(event.data) as FeedMessage;
        } catch {
          return;
        }

        const pools = poolsRef.current;
        if (message.payloadType === "snapshot") {
          pools.clear();
          liveAtRef.current.clear();
          priceHistRef.current.clear();
          for (const token of message.new) pools.set(token.poolId, token);
        } else {
          for (const token of message.new) {
            pools.set(token.poolId, mergeRest(pools.get(token.poolId), token));
          }
          for (const token of message.updated) {
            pools.set(token.poolId, mergeRest(pools.get(token.poolId), token));
          }
          for (const poolId of message.removed) {
            pools.delete(poolId);
            liveAtRef.current.delete(poolId);
            priceHistRef.current.delete(poolId);
          }
        }
        solRef.current = message.solPriceUsd;
        ansemRef.current = message.ansemPriceUsd;
        dirtyRef.current = true;
      };

      socket.onclose = () => {
        if (closed) return;
        setStatus("reconnecting");
        reconnectTimer = window.setTimeout(connect, 1500);
      };

      socket.onerror = () => socket?.close();
    };

    connect();

    const publish = window.setInterval(() => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      setTokens([...poolsRef.current.values()]);
      setSolPriceUsd(solRef.current);
      setAnsemPriceUsd(ansemRef.current);
    }, publishIntervalMs);

    return () => {
      closed = true;
      window.clearInterval(publish);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [publishIntervalMs]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let closed = false;
    const subscribed = new Set<string>();

    const send = (payload: object): void => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
    };

    const pickWatch = (): string[] => {
      const pools = poolsRef.current;
      const preferred = watchRef.current.filter((id) => pools.has(id));
      const ranked = (preferred.length > 0 ? preferred : [...pools.keys()])
        .map((id) => pools.get(id))
        .filter((t): t is Token => t !== undefined)
        .sort(
          (a, b) =>
            b.volumeUsd24h - a.volumeUsd24h ||
            b.txns24h - a.txns24h ||
            b.marketCapUsd - a.marketCapUsd,
        );

      const picked = new Set<string>();
      for (const token of ranked) {
        if (picked.size >= MAX_SUBS) break;
        picked.add(token.poolId);
      }

      const now = Date.now();
      for (const [mint, at] of liveAtRef.current) {
        if (now - at < KEEP_LIVE_MS && pools.has(mint)) picked.add(mint);
      }
      return [...picked];
    };

    const sync = (): void => {
      const live = new Set(pickWatch());
      for (const mint of live) {
        if (subscribed.has(mint)) continue;
        subscribed.add(mint);
        send({ type: "subscribe", channel: "market", mint });
      }
      for (const mint of [...subscribed]) {
        if (live.has(mint)) continue;
        subscribed.delete(mint);
        send({ type: "unsubscribe", channel: "market", mint });
      }
    };

    const priceFromTrade = (data: LiveTradeMessage["data"]): number | null => {
      const quote = Number(data?.priceQuote);
      const usd = Number(data?.priceUsd);
      const solUsd = solRef.current;
      // Match the ansem.io chart: last candle close is priceQuote, USD mcap is
      // close * solUsd * 1e9. When both prints exist they imply the same USD.
      if (usd > 0) return usd;
      if (quote > 0 && solUsd > 0) return quote * solUsd;
      return null;
    };

    const applyTrade = (mint: string, priceUsd: number, at: number): void => {
      const token = poolsRef.current.get(mint);
      if (!token || !(priceUsd > 0)) return;

      const cap = priceUsd * PUMP_SUPPLY;
      if (!Number.isFinite(cap) || !(cap > 0)) return;

      const now = Date.now();
      liveAtRef.current.set(mint, now);

      const hist = priceHistRef.current.get(mint) ?? [];
      hist.push({ t: now, p: priceUsd });
      const cutoff = now - FIVE_MINUTES_MS;
      const trimmed = hist.length > 8 ? hist.filter((h) => h.t >= cutoff) : hist;
      const kept = trimmed.length > 0 ? trimmed : hist.slice(-1);
      priceHistRef.current.set(mint, kept);
      const oldest = kept[0];
      const change5m = oldest && oldest.p > 0 ? priceUsd / oldest.p - 1 : token.change5m;

      poolsRef.current.set(mint, {
        ...token,
        priceUsd,
        marketCapUsd: cap,
        lastTradeAt: at > 0 ? at : now,
        liveTickAt: now,
        change5m: Number.isFinite(change5m) ? change5m : token.change5m,
      });
      dirtyRef.current = true;
    };

    const connect = (): void => {
      socket = new WebSocket(ANSEM_WS);

      socket.onopen = () => {
        subscribed.clear();
        sync();
      };

      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        let msg: LiveTradeMessage;
        try {
          msg = JSON.parse(event.data) as LiveTradeMessage;
        } catch {
          return;
        }
        // Same filter as the ansem.io chart: only tape prints move the live candle.
        if (msg.type !== "trade" || !msg.mint) return;
        const priceUsd = priceFromTrade(msg.data);
        if (priceUsd === null) return;
        const at = Number(msg.data?.ts) || Number(msg.data?.blockTime) || Date.now();
        applyTrade(msg.mint, priceUsd, at);
      };

      socket.onclose = () => {
        subscribed.clear();
        if (closed) return;
        reconnectTimer = window.setTimeout(connect, 1500);
      };

      socket.onerror = () => socket?.close();
    };

    connect();
    const syncTimer = window.setInterval(sync, 1500);

    return () => {
      closed = true;
      window.clearInterval(syncTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  return { tokens, solPriceUsd, ansemPriceUsd, status, setWatchMints };
}
