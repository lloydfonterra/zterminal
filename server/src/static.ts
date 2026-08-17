import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function safeJoin(root: string, pathname: string): string | null {
  const decoded = decodeURIComponent(pathname.split("?")[0] ?? "/");
  const relative = decoded.replace(/^\/+/, "").replace(/\\/g, "/");
  const full = resolve(root, relative);
  const base = resolve(root);
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

function sendFile(res: ServerResponse, file: string): void {
  const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, {
    "content-type": type,
    "cache-control": extname(file) === ".html" ? "no-cache" : "public, max-age=86400",
  });
  createReadStream(file).pipe(res);
}

/** Serves the Vite build so one process can host the map + feed in production. */
export function serveWeb(req: IncomingMessage, res: ServerResponse, dist: string): boolean {
  if (!existsSync(dist)) return false;
  const url = new URL(req.url ?? "/", "http://localhost");
  const target = safeJoin(dist, url.pathname);
  if (!target) {
    res.writeHead(400).end();
    return true;
  }

  if (existsSync(target) && statSync(target).isFile()) {
    sendFile(res, target);
    return true;
  }

  const index = join(dist, "index.html");
  if (existsSync(index) && (url.pathname === "/" || !extname(url.pathname))) {
    sendFile(res, index);
    return true;
  }

  return false;
}
