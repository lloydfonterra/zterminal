import type { Token } from "./types";

export interface Viewport {
  width: number;
  height: number;
}

export interface MapConfig {
  windowSeconds: number;
  minCapUsd: number;
  maxCapUsd: number;
  graduateMcapUsd: number;
}

/**
 * Pump.fun constant-product curve (UI units):
 *   virtual SOL starts at 30, virtual tokens at 1_073_000_191
 *   85 real SOL bought → virtual SOL = 115
 *   mcap_sol = 115² / 30 / 1_073_000_191 * 1e9 ≈ 410.84 SOL
 * USD line = that × live SOL. At $76 SOL this is ~$31.2K (what GMGN draws),
 * not the old "$69K" rule of thumb from when SOL was ~$168.
 */
export const PUMP_VIRTUAL_SOL_INITIAL = 30;
export const PUMP_VIRTUAL_TOKENS_INITIAL = 1_073_000_191;
export const PUMP_GRADUATE_REAL_SOL = 85;
export const PUMP_DISPLAY_SUPPLY = 1_000_000_000;

export const GRADUATE_MCAP_SOL =
  ((PUMP_VIRTUAL_SOL_INITIAL + PUMP_GRADUATE_REAL_SOL) ** 2 /
    PUMP_VIRTUAL_SOL_INITIAL /
    PUMP_VIRTUAL_TOKENS_INITIAL) *
  PUMP_DISPLAY_SUPPLY;

export function graduateMcapUsd(solPriceUsd: number): number {
  if (!(solPriceUsd > 0)) return GRADUATE_MCAP_SOL * 76;
  return GRADUATE_MCAP_SOL * solPriceUsd;
}

export const PADDING = { left: 72, right: 24, top: 28, bottom: 34 };
const CHANGE_CLAMP = 9.99;

export function xForAge(ageMs: number, view: Viewport, cfg: MapConfig): number {
  const span = Math.max(1, view.width - PADDING.left - PADDING.right);
  const fraction = clamp01(ageMs / (cfg.windowSeconds * 1000));
  return PADDING.left + fraction * span;
}

export function yForCap(capUsd: number, view: Viewport, cfg: MapConfig): number {
  const span = Math.max(1, view.height - PADDING.top - PADDING.bottom);
  return PADDING.top + (1 - normalizedCap(capUsd, cfg)) * span;
}

export function normalizedCap(capUsd: number, cfg: MapConfig): number {
  if (!(capUsd > 0)) return 0;
  const lo = Math.log(cfg.minCapUsd);
  const hi = Math.log(cfg.maxCapUsd);
  return clamp01((Math.log(capUsd) - lo) / (hi - lo));
}

export function radiusForCap(capUsd: number, txns: number, cfg: MapConfig): number {
  const scaled = 3 + Math.sqrt(normalizedCap(capUsd, cfg)) * 17;
  const activity = Math.min(4, Math.log10(1 + txns) * 2);
  return scaled + activity;
}

/** 5-minute print only. Null means no history yet — do not fall back to 24h. */
export function liveChange(token: Token): number | null {
  if (token.change5m === 0 || !Number.isFinite(token.change5m)) return null;
  return Math.max(-CHANGE_CLAMP, Math.min(CHANGE_CLAMP, token.change5m));
}

export function formatLiveChange(token: Token): string {
  const change = liveChange(token);
  if (change === null) return "—";
  const pct = change * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

/** Disc fill: curve vs migrated. */
export function fillColorForToken(token: Token): [number, number, number, number] {
  const alpha = token.txns24h === 0 ? 130 : Math.round(160 + Math.min(80, token.txns24h * 0.3));
  if (token.status === "migrated") return [90, 210, 130, alpha];
  return [110, 128, 118, alpha];
}

/** Ring: recent PnL, or flat gray when there is no 5m print. */
export function ringColorForToken(token: Token): [number, number, number, number] {
  const change = liveChange(token);
  if (change === null || Math.abs(change) < 0.01) return [128, 132, 148, 255];
  const intensity = Math.min(1, Math.abs(change) / 0.5);
  if (change > 0) {
    return [Math.round(70 - 40 * intensity), Math.round(170 + 40 * intensity), 110, 255];
  }
  return [Math.round(200 + 40 * intensity), Math.round(70 - 20 * intensity), 90, 255];
}

export function haloColorForToken(token: Token): [number, number, number, number] {
  const [r, g, b] = fillColorForToken(token);
  return [r, g, b, token.status === "migrated" ? 40 : 26];
}

const MCAP_AXIS_USD = [
  1_000_000, 500_000, 200_000, 100_000, 50_000, 30_000, 20_000, 10_000, 5_000, 2_000, 1_000, 250,
] as const;

export function capGridlines(cfg: MapConfig): number[] {
  return MCAP_AXIS_USD.filter(
    (usd) => usd >= cfg.minCapUsd * 0.99 && usd <= cfg.maxCapUsd * 1.01,
  );
}

export function showsGraduation(cfg: MapConfig): boolean {
  const grad = cfg.graduateMcapUsd;
  return grad > 0 && grad >= cfg.minCapUsd * 0.99 && grad <= cfg.maxCapUsd * 1.01;
}

const AGE_STEPS_SEC = [15, 30, 60, 120, 180, 300, 600, 900, 1_800, 3_600];

export function ageGridlines(cfg: MapConfig): number[] {
  const span = Math.max(1, cfg.windowSeconds);
  const step = AGE_STEPS_SEC.find((s) => span / s <= 6) ?? Math.ceil(span / 6);
  const out: number[] = [];
  for (let t = 0; t <= span; t += step) out.push(t * 1000);
  return out;
}

export function formatUsd(usd: number): string {
  const abs = Math.abs(usd);
  if (abs >= 1_000_000_000) return `${(usd / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) {
    const m = usd / 1_000_000;
    return `${m >= 10 ? m.toFixed(1) : m.toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    const k = usd / 1_000;
    return `${k >= 10 ? Math.round(k) : Number(k.toFixed(1))}K`;
  }
  if (abs >= 1) return `${Math.round(usd)}`;
  return usd.toFixed(2);
}

export function formatUsdMoney(usd: number): string {
  return `$${formatUsd(usd)}`;
}

export function formatAge(ms: number): string {
  if (ms < 45_000) return `${Math.max(0, Math.round(ms / 1000))}s`;
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h${minutes}m`;
}

export function formatCurvePct(pct: number): string {
  if (!(pct > 0)) return "0%";
  if (pct >= 99.5) return "99%";
  return pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
