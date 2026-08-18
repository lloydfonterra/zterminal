import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config.js";
import { iconCacheStats, serveIcon } from "./icons.js";
import {
  fetchPumpCoin,
  fetchPumpPage,
  fetchRecentPumpCoins,
  fetchSolPrice,
  listenPumpTrades,
  pollDiag,
} from "./pumpfun.js";
import { MarketState, type PriceQuote } from "./state.js";
import { serveWeb } from "./static.js";

const DELTA_INTERVAL_MS = 50;
const TRADE_FLUSH_MS = 25;
const PING_INTERVAL_MS = 15_000;
const NEW_INTERVAL_MS = 1_000;
const HOT_INTERVAL_MS = 3_000;
const SOL_INTERVAL_MS = 5_000;
const DEEP_INTERVAL_MS = 30_000;
const GC_INTERVAL_MS = 2_000;
const KEEP_MS = 24 * 60 * 60 * 1000;
const MAX_COINS = 1500;
const MAX_NEW_FETCHES = 6;

async function main(): Promise<void> {
  const state = new MarketState();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let stopped = false;
  let liveCount = 0;
  let rotateOffset = 50;
  const pendingTrades = new Map<string, PriceQuote>();
  const fetching = new Set<string>();

  const later = (fn: () => void, ms: number): void => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
  };

  const markOk = (via: string, now: number): void => {
    pollDiag.lastError = null;
    pollDiag.lastOkAt = now;
    pollDiag.lastCount = state.stats.live;
    pollDiag.lastVia = via;
  };

  const newest = async (): Promise<void> => {
    try {
      const now = Date.now();
      const coins = await fetchPumpPage(0);
      if (coins.length === 0) throw new Error("empty pump.fun list");
      state.applyCoins(coins, now, { source: "pump", prune: false });
      liveCount += 1;
      if (pollDiag.nats !== "live") markOk("pump", now);
      if (liveCount === 1) {
        console.log(
          `[server] pump.fun tape + REST, SOL $${state.solPriceUsd > 0 ? state.solPriceUsd.toFixed(2) : "—"}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (pollDiag.nats !== "live") pollDiag.lastError = message;
      console.error("[server] newest poll failed:", message);
    } finally {
      if (!stopped) later(() => void newest(), NEW_INTERVAL_MS);
    }
  };

  const hot = async (): Promise<void> => {
    try {
      const coins = await fetchPumpPage(rotateOffset, "last_trade_timestamp");
      rotateOffset += 50;
      if (rotateOffset >= 200) rotateOffset = 50;
      if (coins.length > 0) {
        state.applyCoins(coins, Date.now(), { source: "pump", prune: false });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[server] hot poll failed:", message);
    } finally {
      if (!stopped) later(() => void hot(), HOT_INTERVAL_MS);
    }
  };

  const sol = async (): Promise<void> => {
    try {
      const price = await fetchSolPrice();
      if (price) state.solPriceUsd = price;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[server] pump.fun sol-price failed:", message);
    } finally {
      if (!stopped) later(() => void sol(), SOL_INTERVAL_MS);
    }
  };

  const deep = async (): Promise<void> => {
    try {
      const now = Date.now();
      const coins = await fetchRecentPumpCoins(KEEP_MS, MAX_COINS);
      if (coins.length === 0) throw new Error("empty pump.fun list");
      state.applyCoins(coins, now, { source: "pump", prune: true });
      if (pollDiag.nats !== "live") markOk("pump-deep", now);
      if (state.stats.live > 0 && liveCount === 0) {
        console.log(
          `[server] loaded ${state.stats.live} pump.fun coins @ SOL $${state.solPriceUsd > 0 ? state.solPriceUsd.toFixed(2) : "—"}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (pollDiag.nats !== "live") pollDiag.lastError = message;
      console.error("[server] deep poll failed:", message);
    } finally {
      if (!stopped) later(() => void deep(), DEEP_INTERVAL_MS);
    }
  };

  const hydrate = (mint: string): void => {
    if (state.has(mint) || fetching.has(mint) || fetching.size >= MAX_NEW_FETCHES) return;
    fetching.add(mint);
    void fetchPumpCoin(mint)
      .then((coin) => {
        if (coin) state.applyCoins([coin], Date.now(), { source: "pump", prune: false });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[server] coin hydrate failed:", message);
      })
      .finally(() => fetching.delete(mint));
  };

  const stopTrades = listenPumpTrades((trade) => {
    pendingTrades.set(trade.mint, {
      mint: trade.mint,
      priceUsd: trade.priceUsd,
      marketCapUsd: trade.marketCapUsd,
      status: trade.isBondingCurve ? "on_curve" : "migrated",
      curvePct: trade.curvePct,
    });
    if (trade.isBondingCurve) hydrate(trade.mint);
  });

  const http = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          ...state.stats,
          solPriceUsd: state.solPriceUsd,
          icons: iconCacheStats(),
          poll: pollDiag,
        }),
      );
      return;
    }

    if (url.pathname.startsWith("/coin/")) {
      const mint = decodeURIComponent(url.pathname.slice("/coin/".length)).trim();
      if (!isSolanaMint(mint)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "bad mint" }));
        return;
      }

      const existing = state.wire(mint);
      if (existing) {
        state.pin(mint);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, token: existing }));
        return;
      }

      void fetchPumpCoin(mint)
        .then((coin) => {
          if (!coin) {
            res.writeHead(404, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "not found" }));
            return;
          }
          state.applyCoins([coin], Date.now(), { source: "pump", prune: false });
          state.pin(mint);
          const token = state.wire(mint);
          if (!token) {
            res.writeHead(404, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "not found" }));
            return;
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, token }));
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error("[server] coin lookup failed:", message);
          if (!res.headersSent) {
            res.writeHead(502, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: "lookup failed" }));
          }
        });
      return;
    }

    if (url.pathname.startsWith("/icon/")) {
      serveIcon(req, res, state);
      return;
    }

    if (serveWeb(req, res, config.webDist)) return;

    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ server: http, path: "/ws/public" });
  const clients = new Set<WebSocket>();

  wss.on("connection", (socket) => {
    clients.add(socket);
    socket.send(JSON.stringify(state.snapshot()));
    socket.on("message", (raw) => {
      if (raw.toString() === "pong") return;
    });
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
  });

  const broadcast = (message: string): void => {
    for (const socket of clients) {
      if (socket.readyState === WebSocket.OPEN) socket.send(message);
    }
  };

  setInterval(() => {
    if (pendingTrades.size === 0) return;
    const quotes = [...pendingTrades.values()];
    pendingTrades.clear();
    state.applyQuotes(quotes, Date.now());
  }, TRADE_FLUSH_MS);

  setInterval(() => state.gc(Date.now()), GC_INTERVAL_MS);

  setInterval(() => {
    const delta = state.drainDelta();
    if (!delta || clients.size === 0) return;
    broadcast(JSON.stringify(delta));
  }, DELTA_INTERVAL_MS);

  setInterval(() => broadcast("ping"), PING_INTERVAL_MS);

  http.listen(config.port, config.host, () => {
    console.log(`[server] listening on http://${config.host}:${config.port}`);
    console.log(`[server] feed at ws://${config.host}:${config.port}/ws/public`);
  });

  void sol();
  void deep();
  void newest();
  void hot();

  const shutdown = (): void => {
    console.log("\n[server] shutting down");
    stopped = true;
    stopTrades();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const socket of clients) socket.close();
    http.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function isSolanaMint(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

main().catch((error) => {
  console.error("[server] fatal:", error);
  process.exit(1);
});
