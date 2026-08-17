import type { Token } from "./types";

export interface Viewport {
  width: number;
  height: number;
}

export interface MapConfig {
  windowSeconds: number;
  minCapUsd: number;
  maxCapUsd: number;
}

export const PADDING = { left: 72, right: 24, top: 28, bottom: 34 };

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

export function colorForToken(token: Token): [number, number, number, number] {
  const change = token.change5m !== 0 ? token.change5m : token.change24h;
  const intensity = Math.min(1, Math.abs(change) / 0.5);
  const alpha = token.txns24h === 0 ? 110 : Math.round(150 + Math.min(105, token.txns24h * 0.4));

  if (Math.abs(change) < 0.01) return [128, 132, 148, alpha];
  if (change > 0) {
    return [Math.round(70 - 40 * intensity), Math.round(170 + 40 * intensity), 110, alpha];
  }
  return [Math.round(200 + 40 * intensity), Math.round(70 - 20 * intensity), 90, alpha];
}

export type TokenTier = "free" | "gold" | "diamond";

export function tokenTier(token: Token): TokenTier {
  const tier = token.tier.trim().toLowerCase();
  if (tier === "gold" || tier === "diamond") return tier;
  return "free";
}

const GOLD_RGB = [232, 186, 64] as const;
const DIAMOND_RGB = [186, 228, 255] as const;

/** Stroke on the badge ring. Paid tiers keep their metal; free uses PnL colour. */
export function ringColorForToken(token: Token): [number, number, number, number] {
  const tier = tokenTier(token);
  if (tier === "gold") return [...GOLD_RGB, 255];
  if (tier === "diamond") return [...DIAMOND_RGB, 255];
  const [r, g, b] = colorForToken(token);
  return [r, g, b, 255];
}

export function tierGlowColor(token: Token): [number, number, number, number] | null {
  const tier = tokenTier(token);
  if (tier === "gold") return [...GOLD_RGB, 58];
  if (tier === "diamond") return [...DIAMOND_RGB, 62];
  return null;
}

const MCAP_AXIS_USD = [
  1_000_000, 500_000, 200_000, 100_000, 50_000, 30_000, 10_000, 5_000, 2_000, 1_000,
] as const;

export function capGridlines(cfg: MapConfig): number[] {
  return MCAP_AXIS_USD.filter(
    (usd) => usd >= cfg.minCapUsd * 0.99 && usd <= cfg.maxCapUsd * 1.01,
  );
}

export function ageGridlines(cfg: MapConfig, count = 6): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i += 1) out.push((cfg.windowSeconds * 1000 * i) / count);
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
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h${minutes}m`;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
