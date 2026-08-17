import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, "../../.env") });

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? fallback : raw;
}

export const config = {
  ansemApiBase: str("ANSEM_API_BASE", "https://ansem.io").replace(/\/$/, ""),
  pollIntervalMs: num("POLL_INTERVAL_MS", 2500),
  port: num("PORT", 8787),
  host: str("HOST", "0.0.0.0"),
  webDist: resolve(here, "../../web/dist"),
  /**
   * Cloudflare challenges bare curl/node fingerprints on the HTML site, but the
   * JSON API accepts a browser UA. Keep this aligned with a current Chrome.
   */
  userAgent: str(
    "ANSEM_USER_AGENT",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  ),
};
