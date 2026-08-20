import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { OrthographicView } from "@deck.gl/core";
import { IconLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Token } from "./types";
import { IconAtlas, logoUrl, type ChartProvider } from "./iconAtlas";
import { InspectCard } from "./InspectCard";
import {
  PADDING,
  ageGridlines,
  capGridlines,
  fillColorForToken,
  formatAge,
  formatUsd,
  formatUsdMoney,
  haloColorForToken,
  radiusForCap,
  ringColorForToken,
  showsGraduation,
  xForAge,
  yForCap,
  type MapConfig,
  type Viewport,
} from "./scales";

/** Log-space ease toward the live chart print. Long enough to glide, short enough to track the tape. */
const SMOOTH_MS = 220;
const LABEL_MIN_RADIUS = 11;

interface Props {
  tokens: Token[];
  allTokens?: Token[];
  config: MapConfig;
  chart: ChartProvider;
  selectedId: string | null;
  inspectId?: string | null;
  onSelect: (poolId: string | null) => void;
  onInspectClose?: () => void;
  focusId?: string | null;
  watchedMints?: Set<string>;
  onToggleWatch?: (mint: string) => void;
}

interface Placed {
  token: Token;
  iconId: string;
  radius: number;
}

const CARD_HIDE_MS = 240;

export function MarketMap({
  tokens,
  allTokens,
  config,
  chart,
  selectedId,
  inspectId = null,
  onSelect,
  onInspectClose,
  focusId = null,
  watchedMints,
  onToggleWatch,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const atlasRef = useRef<IconAtlas | null>(null);
  const smoothCaps = useRef(new Map<string, number>());
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;
  const [view, setView] = useState<Viewport>({ width: 1200, height: 700 });
  const [now, setNow] = useState(() => Date.now());
  const [cardId, setCardId] = useState<string | null>(null);
  const overCardRef = useRef(false);
  const hideTimer = useRef(0);

  if (atlasRef.current === null) atlasRef.current = new IconAtlas();
  const atlas = atlasRef.current;

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        setView({ width: rect.width, height: rect.height });
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (clock: number): void => {
      const dt = Math.min(48, clock - last);
      last = clock;
      const alpha = 1 - Math.exp(-dt / SMOOTH_MS);
      const live = tokensRef.current;
      const seen = new Set<string>();
      const caps = smoothCaps.current;
      for (const token of live) {
        seen.add(token.poolId);
        const target = token.marketCapUsd;
        const prev = caps.get(token.poolId);
        if (prev === undefined || !(prev > 0) || !(target > 0)) {
          caps.set(token.poolId, target);
          continue;
        }
        // Ease in log space so Y motion is constant-speed on the log mcap axis.
        const next = Math.exp(Math.log(prev) + (Math.log(target) - Math.log(prev)) * alpha);
        caps.set(token.poolId, next);
      }
      for (const id of caps.keys()) {
        if (!seen.has(id)) caps.delete(id);
      }
      setNow(Date.now());
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const revealCard = useCallback((id: string | null): void => {
    if (id) {
      window.clearTimeout(hideTimer.current);
      setCardId(id);
      return;
    }
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!overCardRef.current) setCardId(null);
    }, CARD_HIDE_MS);
  }, []);

  const dismissCard = useCallback((): void => {
    overCardRef.current = false;
    window.clearTimeout(hideTimer.current);
    setCardId(null);
    onInspectClose?.();
  }, [onInspectClose]);

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  const visible = useMemo(() => {
    const within = tokens.filter((t) => now - t.createdAt <= config.windowSeconds * 1000);
    const keep = new Set(within.map((t) => t.poolId));
    for (const token of tokens) {
      if ((token.poolId === selectedId || token.poolId === focusId) && !keep.has(token.poolId)) {
        within.push(token);
        keep.add(token.poolId);
      }
    }
    return within;
  }, [tokens, now, config.windowSeconds, selectedId, focusId]);

  const familyCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const token of allTokens ?? tokens) {
      const creator = token.creator;
      if (!creator) continue;
      counts.set(creator, (counts.get(creator) ?? 0) + 1);
    }
    return counts;
  }, [allTokens, tokens]);

  const displayCap = (token: Token): number =>
    smoothCaps.current.get(token.poolId) ?? token.marketCapUsd;

  const { placed, dots } = useMemo(() => {
    const keep = new Set(visible.map((t) => t.token));
    atlas.retain(keep);
    const placedTokens: Placed[] = [];
    const dotTokens: Token[] = [];
    for (const token of visible) {
      const cap = displayCap(token);
      const radius = radiusForCap(cap, token.txns24h, config);
      const iconId = atlas.ensure(token.token, token.symbol, logoUrl(token.token));
      if (iconId === null) dotTokens.push(token);
      else placedTokens.push({ token, iconId, radius });
    }
    return { placed: placedTokens, dots: dotTokens };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, config, atlas, now]);

  const position = (token: Token): [number, number] => [
    xForAge(now - token.createdAt, view, config),
    yForCap(displayCap(token), view, config),
  ];

  const radiusOf = (token: Token): number =>
    radiusForCap(displayCap(token), token.txns24h, config);

  const labelled = declutter(placed, position);
  const positionTrigger = [now, view.width, view.height, config];

  const selected =
    (selectedId && visible.find((t) => t.poolId === selectedId)) ||
    (selectedId && tokens.find((t) => t.poolId === selectedId)) ||
    null;

  const focusToken =
    (focusId && visible.find((t) => t.poolId === focusId)) ||
    (focusId && tokens.find((t) => t.poolId === focusId)) ||
    null;

  const cardToken =
    (cardId && (visible.find((t) => t.poolId === cardId) || tokens.find((t) => t.poolId === cardId))) ||
    (inspectId && (visible.find((t) => t.poolId === inspectId) || tokens.find((t) => t.poolId === inspectId))) ||
    null;

  const pulseTargets = useMemo(() => {
    if (cardToken) return [cardToken];
    if (selected) return [selected];
    if (focusToken) return [focusToken];
    return [] as Token[];
  }, [cardToken, selected, focusToken]);

  const pick = (object: unknown): void => {
    const token = pickedToken(object);
    if (!token) {
      overCardRef.current = false;
      window.clearTimeout(hideTimer.current);
      setCardId(null);
      onSelect(null);
      return;
    }
    onSelect(token.poolId);
  };

  const atlasTexture = atlas.atlas;
  const breathe = 0.5 + 0.5 * Math.sin(now / 380);
  const socialMarks: Array<{ token: Token; radius: number }> = [];
  for (const p of placed) {
    if (hasSocials(p.token)) socialMarks.push({ token: p.token, radius: p.radius });
  }
  for (const token of dots) {
    if (hasSocials(token)) socialMarks.push({ token, radius: radiusOf(token) });
  }
  const familyMarks: Array<{ token: Token; radius: number; count: number; color: [number, number, number, number] }> =
    [];
  for (const p of placed) {
    const count = familySize(p.token, familyCount);
    if (count >= 2) familyMarks.push({ token: p.token, radius: p.radius, count, color: familyColor(p.token.creator) });
  }
  for (const token of dots) {
    const count = familySize(token, familyCount);
    if (count >= 2) {
      familyMarks.push({ token, radius: radiusOf(token), count, color: familyColor(token.creator) });
    }
  }

  const layers = [
    new ScatterplotLayer<Token>({
      id: "halo",
      data: visible,
      getPosition: position,
      getRadius: (t) => radiusOf(t) * 1.85,
      getFillColor: haloColorForToken,
      radiusUnits: "pixels",
      updateTriggers: { getPosition: positionTrigger, getRadius: positionTrigger },
    }),

    new ScatterplotLayer<Token>({
      id: "dots",
      data: dots,
      getPosition: position,
      getRadius: (t) => Math.max(3.5, radiusOf(t) * 0.85),
      getFillColor: fillColorForToken,
      getLineColor: (t) => ringColorForToken(t),
      getLineWidth: 1.2,
      lineWidthUnits: "pixels",
      stroked: true,
      radiusUnits: "pixels",
      pickable: true,
      updateTriggers: { getPosition: positionTrigger, getRadius: positionTrigger },
    }),

    new ScatterplotLayer<Placed>({
      id: "rings",
      data: placed,
      getPosition: (p) => position(p.token),
      getRadius: (p) => p.radius,
      getLineColor: (p) => ringColorForToken(p.token),
      getLineWidth: (p) => Math.max(1.5, p.radius * 0.16),
      lineWidthUnits: "pixels",
      stroked: true,
      filled: true,
      getFillColor: [23, 19, 14, 255],
      radiusUnits: "pixels",
      pickable: true,
      updateTriggers: { getPosition: positionTrigger, getRadius: [config], getLineWidth: [config] },
    }),

    ...(atlasTexture
      ? [
          new IconLayer<Placed>({
            id: "icons",
            data: placed,
            iconAtlas: atlasTexture,
            iconMapping: atlas.mapping,
            getIcon: (p) => p.iconId,
            getPosition: (p) => position(p.token),
            getSize: (p) => p.radius * 2 - Math.max(2.5, p.radius * 0.3),
            sizeUnits: "pixels",
            pickable: true,
            updateTriggers: { getPosition: positionTrigger, getSize: [config] },
          }),
        ]
      : []),

    new ScatterplotLayer<{ token: Token; radius: number }>({
      id: "social-glow",
      data: socialMarks,
      getPosition: (p) => diamondPos(position(p.token), p.radius),
      getRadius: () => 8 + breathe * 4,
      getFillColor: [192, 88, 16, Math.round(22 + breathe * 36)],
      radiusUnits: "pixels",
      pickable: false,
      updateTriggers: { getPosition: positionTrigger, getRadius: [now], getFillColor: [now] },
    }),

    new TextLayer<{ token: Token; radius: number }>({
      id: "social-diamond",
      data: socialMarks,
      getPosition: (p) => diamondPos(position(p.token), p.radius),
      getText: () => "◆",
      getSize: () => 11 + breathe * 1.8,
      getColor: [240, 198, 88, Math.round(190 + breathe * 50)],
      getTextAnchor: "middle",
      getAlignmentBaseline: "center",
      fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontWeight: 700,
      outlineWidth: 2,
      outlineColor: [23, 19, 14, 230],
      characterSet: "◆",
      pickable: false,
      updateTriggers: { getPosition: positionTrigger, getSize: [now], getColor: [now] },
    }),

    new TextLayer<{ token: Token; radius: number; count: number; color: [number, number, number, number] }>({
      id: "dev-family",
      data: familyMarks,
      getPosition: (p) => {
        const [x, y] = position(p.token);
        return [x + p.radius * 0.72, y - p.radius * 0.72];
      },
      getText: (p) => `×${p.count}`,
      getSize: 11,
      getColor: (p) => p.color,
      getTextAnchor: "middle",
      getAlignmentBaseline: "center",
      fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontWeight: 700,
      outlineWidth: 2,
      outlineColor: [23, 19, 14, 230],
      characterSet: "×0123456789",
      pickable: false,
      updateTriggers: { getPosition: positionTrigger, getText: [familyCount] },
    }),

    new ScatterplotLayer<Token>({
      id: "focus-ring",
      data: pulseTargets,
      getPosition: position,
      getRadius: (t) => radiusOf(t) + 6 + Math.sin(now / 180) * 2,
      getLineColor: [192, 88, 16, 220],
      getLineWidth: 2,
      lineWidthUnits: "pixels",
      stroked: true,
      filled: false,
      radiusUnits: "pixels",
      pickable: false,
      updateTriggers: { getPosition: positionTrigger, getRadius: [now] },
    }),

    new TextLayer<Placed>({
      id: "symbol-labels",
      data: labelled.filter((p) => labelText(p.token)),
      getPosition: (p) => {
        const [x, y] = position(p.token);
        return [x, y - p.radius - (hasSocials(p.token) ? 16 : 8)];
      },
      getText: (p) => labelText(p.token),
      getSize: (p) => Math.max(13, Math.min(17, 11 + p.radius * 0.35)),
      getColor: [239, 231, 214, 255],
      getTextAnchor: "middle",
      getAlignmentBaseline: "bottom",
      fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontWeight: 700,
      outlineWidth: 2.5,
      outlineColor: [23, 19, 14, 230],
      characterSet: "auto",
      updateTriggers: { getPosition: positionTrigger, getSize: [config] },
    }),

    new TextLayer<Placed>({
      id: "mcap-labels",
      data: labelled.filter((p) => p.radius >= LABEL_MIN_RADIUS),
      getPosition: (p) => {
        const [x, y] = position(p.token);
        return [x, y + p.radius + 7];
      },
      getText: (p) => formatUsdMoney(p.token.marketCapUsd),
      getSize: 12,
      getColor: [168, 138, 68, 240],
      getTextAnchor: "middle",
      getAlignmentBaseline: "top",
      fontFamily: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontWeight: 600,
      outlineWidth: 2,
      outlineColor: [23, 19, 14, 210],
      characterSet: "auto",
      updateTriggers: { getPosition: positionTrigger },
    }),
  ];

  return (
    <div ref={containerRef} className="map">
      <MapGrid view={view} config={config} />
      <DeckGL
        views={new OrthographicView({ id: "ortho" })}
        viewState={{ target: [view.width / 2, view.height / 2, 0], zoom: 0 }}
        controller={false}
        layers={layers}
        style={{ position: "absolute", inset: "0", background: "transparent" }}
        onDeviceInitialized={(device) => atlas.attach(device)}
        getCursor={({ isHovering }) => (isHovering ? "pointer" : "default")}
        onHover={({ object }) => {
          const token = pickedToken(object);
          if (token) {
            if (inspectId && inspectId !== token.poolId) onInspectClose?.();
            revealCard(token.poolId);
            return;
          }
          revealCard(null);
        }}
        onClick={({ object }) => pick(object)}
      />
      {cardToken && (
        <InspectCard
          token={cardToken}
          now={now}
          chart={chart}
          devCount={familySize(cardToken, familyCount)}
          {...cardBeside(position(cardToken), radiusOf(cardToken), view)}
          onClose={dismissCard}
          onMouseEnter={() => {
            overCardRef.current = true;
            window.clearTimeout(hideTimer.current);
          }}
          onMouseLeave={() => {
            overCardRef.current = false;
            revealCard(null);
          }}
          watched={watchedMints?.has(cardToken.token) ?? false}
          onToggleWatch={onToggleWatch ? () => onToggleWatch(cardToken.token) : undefined}
        />
      )}
    </div>
  );
}

function pickedToken(object: unknown): Token | null {
  if (object === null || typeof object !== "object") return null;
  if ("iconId" in object) return (object as Placed).token;
  return object as Token;
}

function hasSocials(token: Token): boolean {
  return Boolean(token.twitter || token.telegram || token.website);
}

function familySize(token: Token, counts: Map<string, number>): number {
  if (!token.creator) return 0;
  return counts.get(token.creator) ?? 0;
}

function familyColor(creator: string | null | undefined): [number, number, number, number] {
  if (!creator) return [255, 196, 80, 240];
  let hash = 0;
  for (let i = 0; i < creator.length; i += 1) hash = (hash * 33 + creator.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return hslRgb(hue, 0.72, 0.62);
}

function hslRgb(h: number, s: number, l: number): [number, number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255), 245];
}

function diamondPos([x, y]: [number, number], radius: number): [number, number] {
  return [x, y - radius - 2];
}

function labelText(token: Token): string {
  return token.symbol.replace(/[^\x20-\x7e]/g, "").slice(0, 12);
}

const CHAR_WIDTH = 8.2;

function declutter(items: Placed[], position: (token: Token) => [number, number]): Placed[] {
  const ranked = [...items].sort((a, b) => b.token.marketCapUsd - a.token.marketCapUsd);
  const taken: Array<[number, number, number, number]> = [];
  const kept: Placed[] = [];

  for (const item of ranked) {
    const [x, y] = position(item.token);
    const width = Math.max(labelText(item.token).length, 5) * CHAR_WIDTH + 10;
    const left = x - width / 2;
    const right = x + width / 2;
    const top = y - item.radius - 26;
    const bottom = y + item.radius + 24;

    const collides = taken.some(
      ([l, t, r, b]) => left < r && right > l && top < b && bottom > t,
    );
    if (collides) continue;

    taken.push([left, top, right, bottom]);
    kept.push(item);
  }
  return kept;
}

function MapGrid({ view, config }: { view: Viewport; config: MapConfig }) {
  const caps = capGridlines(config);
  const ages = ageGridlines(config);
  const grad = showsGraduation(config);
  const gradY = yForCap(config.graduateMcapUsd, view, config);

  return (
    <svg className="grid" width={view.width} height={view.height} aria-hidden="true">
      {caps.map((capUsd) => {
        const y = yForCap(capUsd, view, config);
        return (
          <g key={`cap-${capUsd}`}>
            <line x1={PADDING.left} x2={view.width - PADDING.right} y1={y} y2={y} />
            <text className="axis-mcap" x={PADDING.left - 10} y={y + 3} textAnchor="end">
              {formatUsd(capUsd)}
            </text>
          </g>
        );
      })}
      {grad && (
        <g>
          <line
            className="grad-line"
            x1={PADDING.left}
            x2={view.width - PADDING.right}
            y1={gradY}
            y2={gradY}
          />
          <text className="grad-label" x={PADDING.left - 10} y={gradY + 3} textAnchor="end">
            {formatUsd(config.graduateMcapUsd)}
          </text>
        </g>
      )}
      {ages.map((age) => {
        const x = xForAge(age, view, config);
        return (
          <g key={`age-${age}`}>
            <line x1={x} x2={x} y1={PADDING.top} y2={view.height - PADDING.bottom} />
            <text x={x} y={view.height - PADDING.bottom + 16} textAnchor="middle">
              {age === 0 ? "new" : formatAge(age)}
            </text>
          </g>
        );
      })}
      <text className="axis-title" x={PADDING.left - 10} y={PADDING.top - 10} textAnchor="end">
        market cap
      </text>
    </svg>
  );
}

const CARD_W = 388;
const CARD_GAP = 14;

function cardBeside(
  [x, y]: [number, number],
  radius: number,
  view: Viewport,
): { x: number; y: number } {
  const maxH = Math.max(240, view.height - 16);
  let left = x + radius + CARD_GAP;
  if (left + CARD_W > view.width - 8) left = x - radius - CARD_GAP - CARD_W;
  left = Math.max(8, Math.min(left, view.width - CARD_W - 8));
  const top = Math.max(8, Math.min(y - 36, view.height - maxH - 8));
  return { x: left, y: top };
}
