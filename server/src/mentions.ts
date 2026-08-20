import { recordPosters } from "./posters.js";

export interface CaMention {
  handle: string;
  name: string;
  tweetId: string;
  createdAt: number;
  url: string;
  text: string;
}

export type MentionStatus = "ok" | "limited" | "disabled" | "error";

export interface MentionResult {
  mentions: CaMention[];
  status: MentionStatus;
}

const MAX_MENTIONS = 3;
const CACHE_MS = 120_000;
const SEARCH_TIMEOUT_MS = 25_000;
const MIN_GAP_MS = 2_000;
const COOLDOWN_MS = 60_000;
const HOST = "api.scraper.tech";

const cache = new Map<string, { at: number; result: MentionResult }>();
const inflight = new Map<string, Promise<MentionResult>>();
let chain: Promise<void> = Promise.resolve();
let lastRequestAt = 0;
let cooldownUntil = 0;
let loggedShape = false;

export function twitterSearchEnabled(): boolean {
  return Boolean(scraperKey());
}

export async function searchCaMentions(mint: string, sinceMs?: number): Promise<MentionResult> {
  const key = mint;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS && cached.result.status === "ok") {
    return {
      status: "ok",
      mentions: filterSince(cached.result.mentions, sinceMs),
    };
  }

  const pending = inflight.get(key);
  if (pending) return pending.then((result) => applySince(result, sinceMs));

  if (!scraperKey()) return { mentions: [], status: "disabled" };
  if (Date.now() < cooldownUntil) return { mentions: [], status: "limited" };

  const run = enqueue(() => doSearch(mint, key)).finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run.then((result) => applySince(result, sinceMs));
}

function applySince(result: MentionResult, sinceMs?: number): MentionResult {
  if (result.status !== "ok") return result;
  return { status: "ok", mentions: filterSince(result.mentions, sinceMs) };
}

function filterSince(mentions: CaMention[], sinceMs?: number): CaMention[] {
  if (!sinceMs || sinceMs <= 0) return mentions.slice(0, MAX_MENTIONS);
  return mentions.filter((m) => m.createdAt >= sinceMs - 60_000).slice(0, MAX_MENTIONS);
}

async function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function doSearch(mint: string, key: string): Promise<MentionResult> {
  if (Date.now() < cooldownUntil) return { mentions: [], status: "limited" };
  await waitTurn();
  if (Date.now() < cooldownUntil) return { mentions: [], status: "limited" };

  try {
    const mentions = await searchTweets(mint);
    const result: MentionResult = { mentions, status: "ok" };
    cache.set(key, { at: Date.now(), result });
    recordPosters(
      mint,
      mentions.map((row) => row.handle),
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[server] x search failed:", message);
    if (message.includes("429")) {
      cooldownUntil = Date.now() + COOLDOWN_MS;
      return { mentions: [], status: "limited" };
    }
    return { mentions: [], status: "error" };
  }
}

function scraperKey(): string {
  return (
    process.env.SCRAPER_KEY ||
    process.env.RAPIDAPI_KEY ||
    process.env.X_RAPIDAPI_KEY ||
    ""
  ).trim();
}

async function waitTurn(): Promise<void> {
  const wait = Math.max(0, lastRequestAt + MIN_GAP_MS - Date.now(), cooldownUntil - Date.now());
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

async function searchTweets(mint: string): Promise<CaMention[]> {
  const body =
    (await fetchSearch(mint, "Latest")) ?? (await fetchSearch(mint, "Top"));
  if (!body) return [];
  if (!loggedShape) {
    loggedShape = true;
    const rec = isRec(body) ? body : {};
    console.log("[server] x search keys:", Object.keys(rec).join(", ") || "(empty)");
  }

  const tweets = tweetsFromBody(body).sort((a, b) => a.createdAt - b.createdAt);
  const seen = new Set<string>();
  const mentions: CaMention[] = [];
  for (const tweet of tweets) {
    const handle = tweet.handle.replace(/^@/, "");
    if (!handle || seen.has(handle.toLowerCase())) continue;
    if (tweet.text.startsWith("RT @")) continue;
    seen.add(handle.toLowerCase());
    mentions.push({
      handle,
      name: tweet.name || handle,
      tweetId: tweet.tweetId,
      createdAt: tweet.createdAt,
      url: `https://x.com/${handle}/status/${tweet.tweetId}`,
      text: tweet.text.trim(),
    });
    if (mentions.length >= MAX_MENTIONS) break;
  }
  return mentions;
}

async function fetchSearch(query: string, searchType: "Latest" | "Top"): Promise<unknown | null> {
  const params = new URLSearchParams({ query, search_type: searchType });
  const res = await fetch(`https://${HOST}/search.php?${params}`, {
    headers: {
      "scraper-key": scraperKey(),
    },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (res.status === 429) throw new Error("scraper 429");
  if (!res.ok) {
    if (searchType === "Latest") return null;
    const text = await res.text();
    throw new Error(`scraper ${res.status} ${text.slice(0, 120)}`);
  }
  return res.json();
}

function tweetsFromBody(body: unknown): ParsedTweet[] {
  if (!body || typeof body !== "object") return [];
  const rec = body as Record<string, unknown>;
  const rows =
    asArray(rec.timeline) ??
    asArray(rec.tweets) ??
    asArray(nested(rec.data, "timeline")) ??
    asArray(nested(rec.data, "tweets"));
  const out: ParsedTweet[] = [];
  for (const row of rows ?? []) {
    const tweet = asTweet(row);
    if (tweet) out.push(tweet);
  }
  return out;
}

function asTweet(row: unknown): ParsedTweet | null {
  if (!row || typeof row !== "object") return null;
  const rec = row as Record<string, unknown>;
  if (rec.type && rec.type !== "tweet") return null;
  if (rec.retweeted || rec.retweeted_tweet) return null;
  const author = isRec(rec.author) ? rec.author : isRec(rec.user) ? rec.user : null;
  const handle =
    str(rec.screen_name) ||
    str(author?.screen_name) ||
    str(author?.username) ||
    str(rec.username);
  const tweetId = str(rec.tweet_id) || str(rec.rest_id) || str(rec.id_str) || str(rec.id);
  if (!handle || !tweetId || !/^\d{8,20}$/.test(tweetId)) return null;
  const createdAt = parseTime(str(rec.created_at) || str(rec.createdAt));
  return {
    handle,
    name: str(rec.name) || str(author?.name) || handle,
    tweetId,
    createdAt: createdAt || Date.now(),
    text: str(rec.full_text) || str(rec.text),
  };
}

function parseTime(raw: string): number {
  if (!raw) return 0;
  if (/^\d{10,13}$/.test(raw)) {
    const n = Number(raw);
    return n < 1e12 ? n * 1000 : n;
  }
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function nested(rec: unknown, key: string): unknown {
  return isRec(rec) ? rec[key] : undefined;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function isRec(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

interface ParsedTweet {
  handle: string;
  name: string;
  tweetId: string;
  createdAt: number;
  text: string;
}
