import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { fetchCoins, fetchMarket, pollDiag } from "./ansem.js";
import { config } from "./config.js";
import { iconCacheStats, serveIcon } from "./icons.js";
import { MarketState } from "./state.js";
import { serveWeb } from "./static.js";

const DELTA_INTERVAL_MS = 200;
const PING_INTERVAL_MS = 15_000;
const MARKET_EVERY = 8;

async function main(): Promise<void> {
  const state = new MarketState();
  let pollCount = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const poll = async (): Promise<void> => {
    try {
      const now = Date.now();
      if (pollCount % MARKET_EVERY === 0) {
        const quote = await fetchMarket();
        if (quote) {
          state.solPriceUsd = quote.solUsd;
          state.ansemPriceUsd = quote.priceUsd;
        }
      }
      const coins = await fetchCoins();
      state.applyCoins(coins, now);
      pollCount += 1;
      pollDiag.lastError = null;
      pollDiag.lastOkAt = now;
      pollDiag.lastCount = coins.length;
      if (pollCount === 1) {
        console.log(`[server] loaded ${coins.length} ansem.io coins via ${pollDiag.lastVia}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      pollDiag.lastError = message;
      console.error("[server] poll failed:", message);
    } finally {
      if (!stopped) {
        timer = setTimeout(() => void poll(), config.pollIntervalMs);
      }
    }
  };

  const http = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          ...state.stats,
          solPriceUsd: state.solPriceUsd,
          ansemPriceUsd: state.ansemPriceUsd,
          icons: iconCacheStats(),
          poll: pollDiag,
        }),
      );
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
    const delta = state.drainDelta();
    if (!delta || clients.size === 0) return;
    broadcast(JSON.stringify(delta));
  }, DELTA_INTERVAL_MS);

  setInterval(() => broadcast("ping"), PING_INTERVAL_MS);

  http.listen(config.port, config.host, () => {
    console.log(`[server] listening on http://${config.host}:${config.port}`);
    console.log(`[server] feed at ws://${config.host}:${config.port}/ws/public`);
  });

  await poll();

  const shutdown = (): void => {
    console.log("\n[server] shutting down");
    stopped = true;
    if (timer) clearTimeout(timer);
    for (const socket of clients) socket.close();
    http.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[server] fatal:", error);
  process.exit(1);
});
