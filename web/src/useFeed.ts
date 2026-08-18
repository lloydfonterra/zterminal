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

export function useFeed(publishIntervalMs = 32): Feed {
  const poolsRef = useRef(new Map<string, Token>());
  const solRef = useRef(0);
  const ansemRef = useRef(0);
  const dirtyRef = useRef(false);

  const [tokens, setTokens] = useState<Token[]>([]);
  const [solPriceUsd, setSolPriceUsd] = useState(0);
  const [ansemPriceUsd, setAnsemPriceUsd] = useState(0);
  const [status, setStatus] = useState<ConnectionState>("connecting");

  const setWatchMints = useCallback((_mints: string[]): void => {}, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let closed = false;

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
          for (const token of message.new) pools.set(token.poolId, token);
        } else {
          for (const token of message.new) pools.set(token.poolId, token);
          for (const token of message.updated) pools.set(token.poolId, token);
          for (const poolId of message.removed) pools.delete(poolId);
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

  return { tokens, solPriceUsd, ansemPriceUsd, status, setWatchMints };
}
