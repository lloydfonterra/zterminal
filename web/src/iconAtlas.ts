import type { Device, Texture } from "@luma.gl/core";

const CELL = 48;
const COLUMNS = 48;
const CAPACITY = COLUMNS * COLUMNS;
const SIZE = CELL * COLUMNS;

export interface IconMappingEntry {
  x: number;
  y: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  mask: boolean;
}

export class IconAtlas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scratch: HTMLCanvasElement;
  private scratchCtx: CanvasRenderingContext2D;
  private texture: Texture | null = null;

  private slots = new Map<string, number>();
  private occupier = new Map<number, string>();
  private free: number[] = [];
  private nextIndex = 0;
  private awaitingUpload = new Set<number>();
  private failed = new Set<string>();
  private inFlight = new Set<string>();

  readonly mapping: Record<string, IconMappingEntry> = {};

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.ctx = context2d(this.canvas);

    this.scratch = document.createElement("canvas");
    this.scratch.width = CELL;
    this.scratch.height = CELL;
    this.scratchCtx = context2d(this.scratch);
  }

  attach(device: Device): void {
    if (this.texture) return;
    this.texture = device.createTexture({
      format: "rgba8unorm",
      width: SIZE,
      height: SIZE,
      mipLevels: 1,
      sampler: {
        minFilter: "linear",
        magFilter: "linear",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      },
    });

    const pending = [...this.awaitingUpload];
    this.awaitingUpload.clear();
    for (const index of pending) void this.upload(index);
  }

  get atlas(): Texture | null {
    return this.texture;
  }

  retain(keep: Set<string>): void {
    for (const mint of [...this.slots.keys()]) {
      if (!keep.has(mint)) this.release(mint);
    }
  }

  ensure(mint: string, symbol: string, imageUrl: string | null): string | null {
    if (this.slots.has(mint)) return mint;
    const index = this.free.pop() ?? (this.nextIndex < CAPACITY ? this.nextIndex++ : -1);
    if (index < 0) return null;

    this.slots.set(mint, index);
    this.occupier.set(index, mint);
    this.mapping[mint] = cellToMapping(index);

    this.drawFallback(index, mint, symbol);
    void this.upload(index);

    if (imageUrl && !this.failed.has(mint) && !this.inFlight.has(mint)) {
      this.inFlight.add(mint);
      void this.loadRemote(index, mint, imageUrl);
    }
    return mint;
  }

  private release(mint: string): void {
    const index = this.slots.get(mint);
    if (index === undefined) return;
    this.slots.delete(mint);
    delete this.mapping[mint];
    this.failed.delete(mint);
    this.inFlight.delete(mint);
    if (this.occupier.get(index) === mint) this.occupier.delete(index);
    this.free.push(index);
  }

  private async loadRemote(index: number, key: string, url: string): Promise<void> {
    try {
      const bitmap = await loadBitmap(url);
      if (this.occupier.get(index) !== key) {
        bitmap.close();
        return;
      }
      this.drawCircularImage(index, bitmap);
      bitmap.close();
      if (this.occupier.get(index) !== key) return;
      await this.upload(index);
    } catch {
      if (this.occupier.get(index) === key) this.failed.add(key);
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async upload(index: number): Promise<void> {
    if (!this.texture) {
      this.awaitingUpload.add(index);
      return;
    }
    const { x, y } = cellOrigin(index);

    this.scratchCtx.clearRect(0, 0, CELL, CELL);
    this.scratchCtx.drawImage(this.canvas, x, y, CELL, CELL, 0, 0, CELL, CELL);
    const cell = await createImageBitmap(this.scratch);
    try {
      this.texture.copyExternalImage({ image: cell, x, y, width: CELL, height: CELL });
    } finally {
      cell.close();
    }
  }

  private drawFallback(index: number, key: string, symbol: string): void {
    const { x, y } = cellOrigin(index);
    const ctx = this.ctx;
    const hue = hashHue(key);
    const initials = toInitials(symbol);

    ctx.save();
    ctx.clearRect(x, y, CELL, CELL);
    circlePath(ctx, x, y);
    ctx.fillStyle = `hsl(${hue} 44% 27%)`;
    ctx.fill();

    ctx.fillStyle = `hsl(${hue} 72% 84%)`;
    ctx.font = `600 ${initials.length > 2 ? 15 : 20}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials, x + CELL / 2, y + CELL / 2 + 1);
    ctx.restore();
  }

  private drawCircularImage(index: number, bitmap: ImageBitmap): void {
    const { x, y } = cellOrigin(index);
    const ctx = this.ctx;

    ctx.save();
    ctx.clearRect(x, y, CELL, CELL);
    circlePath(ctx, x, y);
    ctx.clip();

    const scale = Math.max(CELL / bitmap.width, CELL / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, x + (CELL - w) / 2, y + (CELL - h) / 2, w, h);
    ctx.restore();
  }
}

function circlePath(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.arc(x + CELL / 2, y + CELL / 2, CELL / 2 - 1, 0, Math.PI * 2);
  ctx.closePath();
}

function cellOrigin(index: number): { x: number; y: number } {
  return { x: (index % COLUMNS) * CELL, y: Math.floor(index / COLUMNS) * CELL };
}

function cellToMapping(index: number): IconMappingEntry {
  const { x, y } = cellOrigin(index);
  return {
    x,
    y,
    width: CELL,
    height: CELL,
    anchorX: CELL / 2,
    anchorY: CELL / 2,
    mask: false,
  };
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  return ctx;
}

async function loadBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`status ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) throw new Error(`not an image: ${type}`);
  return createImageBitmap(await res.blob());
}

function hashHue(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 360_000;
  }
  return hash % 360;
}

function toInitials(symbol: string): string {
  const clean = symbol.replace(/[^\x20-\x7e]/g, "").trim();
  if (clean.length === 0) return "?";
  const words = clean.split(/[\s_\-]+/).filter(Boolean);
  if (words.length > 1) {
    return words
      .slice(0, 3)
      .map((word) => word[0]!.toUpperCase())
      .join("");
  }
  return clean.slice(0, 3).toUpperCase();
}

export function logoUrl(mint: string): string {
  return `/icon/${encodeURIComponent(mint)}`;
}

export const CHART_PROVIDERS = [
  { id: "pumpfun", label: "pump.fun" },
  { id: "axiom", label: "axiom" },
  { id: "photon", label: "photon" },
  { id: "gmgn", label: "gmgn" },
  { id: "dexscreener", label: "dexscreener" },
  { id: "maestro", label: "maestro" },
  { id: "trojan", label: "trojan" },
  { id: "ansem", label: "ansem" },
  { id: "bullx", label: "bullx" },
  { id: "padre", label: "padre" },
  { id: "mevx", label: "mevx" },
  { id: "based", label: "based" },
  { id: "birdeye", label: "birdeye" },
  { id: "jupiter", label: "jupiter" },
  { id: "bonkbot", label: "bonkbot" },
  { id: "bloom", label: "bloom" },
] as const;

export type ChartProvider = (typeof CHART_PROVIDERS)[number]["id"];

export const PRIMARY_CHART_IDS: readonly ChartProvider[] = [
  "pumpfun",
  "axiom",
  "photon",
  "gmgn",
  "dexscreener",
  "maestro",
  "trojan",
];

export function chartLabel(provider: ChartProvider): string {
  return CHART_PROVIDERS.find((p) => p.id === provider)?.label ?? provider;
}

export function chartUrl(provider: ChartProvider, mint: string): string {
  switch (provider) {
    case "pumpfun":
      return `https://pump.fun/coin/${mint}`;
    case "gmgn":
      return `https://gmgn.ai/sol/token/${mint}`;
    case "axiom":
      return `https://axiom.trade/meme/${mint}`;
    case "photon":
      return `https://photon-sol.tinyastro.io/en/lp/${mint}`;
    case "bullx":
      return `https://neo.bullx.io/terminal?chainId=1399811149&address=${mint}`;
    case "padre":
      return `https://trade.padre.gg/trade/solana/${mint}`;
    case "mevx":
      return `https://mevx.io/solana/${mint}`;
    case "based":
      return `https://www.based.gg/sol/${mint}`;
    case "dexscreener":
      return `https://dexscreener.com/solana/${mint}`;
    case "birdeye":
      return `https://birdeye.so/token/${mint}?chain=solana`;
    case "jupiter":
      return `https://jup.ag/tokens/${mint}`;
    case "maestro":
      return `https://t.me/MaestroSniperBot?start=${mint}`;
    case "trojan":
      return `https://t.me/solana_trojanbot?start=${mint}`;
    case "bonkbot":
      return `https://t.me/bonkbot_bot?start=${mint}`;
    case "bloom":
      return `https://t.me/BloomSolana_bot?start=${mint}`;
    default:
      return `https://ansem.io/launch/coin/${mint}`;
  }
}
