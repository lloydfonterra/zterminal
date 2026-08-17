import type { IncomingMessage, ServerResponse } from "node:http";
import { MarketState } from "./state.js";

interface Hit {
  bytes: Buffer;
  contentType: string;
  at: number;
}

const HIT_TTL_MS = 6 * 60 * 60 * 1000;
const MISS_TTL_MS = 10 * 60 * 1000;
const FETCH_MS = 12_000;

const hits = new Map<string, Hit>();
const misses = new Map<string, number>();
const inFlight = new Map<string, Promise<Hit | null>>();

function stillFresh(mint: string): Hit | "miss" | null {
  const hit = hits.get(mint);
  if (hit && Date.now() - hit.at < HIT_TTL_MS) return hit;
  const missed = misses.get(mint);
  if (missed && Date.now() - missed < MISS_TTL_MS) return "miss";
  return null;
}

async function fetchImage(url: string): Promise<Hit | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_MS),
      headers: { accept: "image/*,*/*;q=0.8" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/png";
    if (!contentType.startsWith("image/") && contentType !== "application/octet-stream") {
      return null;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 32 || bytes.length > 4_000_000) return null;
    return { bytes, contentType: contentType.startsWith("image/") ? contentType : "image/png", at: Date.now() };
  } catch {
    return null;
  }
}

export function serveIcon(req: IncomingMessage, res: ServerResponse, state: MarketState): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  const mint = decodeURIComponent(url.pathname.slice("/icon/".length));
  if (!mint || mint.includes("/") || mint.length < 32) {
    res.writeHead(400).end();
    return;
  }

  const cached = stillFresh(mint);
  if (cached === "miss") {
    res.writeHead(404).end();
    return;
  }
  if (cached) {
    res.writeHead(200, {
      "content-type": cached.contentType,
      "cache-control": "public, max-age=3600",
    });
    res.end(cached.bytes);
    return;
  }

  const imageUrl = state.imageUrlFor(mint);
  if (!imageUrl) {
    misses.set(mint, Date.now());
    res.writeHead(404).end();
    return;
  }

  let task = inFlight.get(mint);
  if (!task) {
    task = fetchImage(imageUrl).then((hit) => {
      inFlight.delete(mint);
      if (hit) hits.set(mint, hit);
      else misses.set(mint, Date.now());
      return hit;
    });
    inFlight.set(mint, task);
  }

  void task.then((hit) => {
    if (res.writableEnded) return;
    if (!hit) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": hit.contentType,
      "cache-control": "public, max-age=3600",
    });
    res.end(hit.bytes);
  });
}

export function iconCacheStats(): { hits: number; misses: number } {
  return { hits: hits.size, misses: misses.size };
}
