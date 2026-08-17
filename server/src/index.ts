import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { fetchCoins, fetchMarket, loadSnapshot, pollDiag } from "./ansem.js";
import { config } from "./config.js";
import { fetchDexQuotes, fetchSolUsd } from "./dex.js";
import { iconCacheStats, serveIcon } from "./icons.js";
import { MarketState } from "./state.js";
import { serveWeb } from "./static.js";

const DELTA_INTERVAL_MS = 200;
const PING_INTERVAL_MS = 15_000;
const MARKET_EVERY = 8;
const DEX_INTERVAL_MS = 2_500;
const DEX_NEWEST = 60;
/** Rebuild trigger: frontend lives in web/, so watch paths must include the whole repo. */

async function main(): Promise<void> {
  const state = new MarketState();
  let pollCount = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let dexOffset = 0;

  const seedFromSnapshot = (): void => {
    const snap = loadSnapshot();
    if (snap.quote) {
      state.solPriceUsd = snap.quote.solUsd;
      state.ansemPriceUsd = snap.quote.priceUsd;
    }
    if (snap.coins.length === 0) return;
    state.applyCoins(snap.coins, Date.now(), { source: "ansem", prune: "source" });
    pollDiag.lastVia = "snapshot";
    pollDiag.lastCount = snap.coins.length;
    pollDiag.lastOkAt = Date.now();
    console.log(`[server] seeded ${snap.coins.length} coins from snapshot`);
  };

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
      if (coins.length === 0) throw new Error("empty coin list");
      state.applyCoins(coins, now, { source: "ansem", prune: "source" });
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

  const dex = async (): Promise<void> => {
    try {
      const sol = await fetchSolUsd();
      if (sol) state.solPriceUsd = sol;
      const newest = state.newestMints(DEX_NEWEST);
      const all = state.newestMints(2_000);
      const rotate = all.slice(dexOffset, dexOffset + 20);
      dexOffset = all.length === 0 ? 0 : (dexOffset + 20) % all.length;
      const mints = [...new Set([...newest, ...rotate])];
      if (mints.length > 0) {
        const quotes = await fetchDexQuotes(mints);
        state.applyQuotes(quotes, Date.now());
      }
    } catch (error) {
      console.error("[server] dex poll failed:", error instanceof Error ? error.message : error);
    } finally {
      if (!stopped) setTimeout(() => void dex(), DEX_INTERVAL_MS);
    }
  };

  seedFromSnapshot();
  void poll();
  void dex();

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
