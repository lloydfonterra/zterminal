import { useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { OrthographicView } from "@deck.gl/core";
import { IconLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import type { Token } from "./types";
import { IconAtlas, chartUrl, logoUrl, type ChartProvider } from "./iconAtlas";
import {
  GRADUATE_MCAP_USD,
  PADDING,
  ageGridlines,
  capGridlines,
  fillColorForToken,
  formatAge,
  formatLiveChange,
  formatUsd,
  formatUsdMoney,
  haloColorForToken,
  liveChange,
  radiusForCap,
  ringColorForToken,
  showsGraduation,
  xForAge,
  yForCap,
  type MapConfig,
  type Viewport,
} from "./scales";

/** Log-space ease toward the live chart print. Long enough to glide, short enough to track the tape. */
const SMOOTH_MS = 380;
const LOGO_MIN_USD = 2_500;
const LABEL_MIN_RADIUS = 11;

interface Props {
  tokens: Token[];
  config: MapConfig;
  chart: ChartProvider;
  selectedId: string | null;
  onSelect: (poolId: string | null) => void;
  focusId?: string | null;
}

interface Placed {
  token: Token;
  iconId: string;
  radius: number;
}

interface HoverState {
  token: Token;
  x: number;
  y: number;
}

export function MarketMap({
  tokens,
  config,
  chart,
  selectedId,
  onSelect,
  focusId = null,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const atlasRef = useRef<IconAtlas | null>(null);
  const smoothCaps = useRef(new Map<string, number>());
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;
  const [view, setView] = useState<Viewport>({ width: 1200, height: 700 });
  const [now, setNow] = useState(() => Date.now());
  const [hover, setHover] = useState<HoverState | null>(null);

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

  const visible = useMemo(
    () => tokens.filter((t) => now - t.createdAt <= config.windowSeconds * 1000),
    [tokens, now, config.windowSeconds],
  );

  const displayCap = (token: Token): number =>
    smoothCaps.current.get(token.poolId) ?? token.marketCapUsd;

  const { placed, dots } = useMemo(() => {
    const placedTokens: Placed[] = [];
    const dotTokens: Token[] = [];
    for (const token of visible) {
      const cap = displayCap(token);
      const radius = radiusForCap(cap, token.txns24h, config);
      if (cap < LOGO_MIN_USD) {
        dotTokens.push(token);
        continue;
      }
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

  const pulseTargets = useMemo(() => {
    const out: Token[] = [];
    if (selected) out.push(selected);
    else if (focusToken) out.push(focusToken);
    return out;
  }, [selected, focusToken]);

  const openChart = (token: Token): void => {
    onSelect(token.poolId);
    window.open(chartUrl(chart, token.token), "_blank", "noopener,noreferrer");
  };

  const atlasTexture = atlas.atlas;

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
      onClick: ({ object }) => {
        if (object) openChart(object as Token);
        return true;
      },
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
      getFillColor: [16, 18, 24, 255],
      radiusUnits: "pixels",
      pickable: true,
      onClick: ({ object }) => {
        if (object) openChart((object as Placed).token);
        return true;
      },
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
            onClick: ({ object }) => {
              if (object) openChart((object as Placed).token);
              return true;
            },
            updateTriggers: { getPosition: positionTrigger, getSize: [config] },
          }),
        ]
      : []),

    new ScatterplotLayer<Token>({
      id: "focus-ring",
      data: pulseTargets,
      getPosition: position,
      getRadius: (t) => radiusOf(t) + 6 + Math.sin(now / 180) * 2,
      getLineColor: [180, 255, 120, 220],
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
      data: labelled,
      getPosition: (p) => {
        const [x, y] = position(p.token);
        return [x, y - p.radius - 8];
      },
      getText: (p) => labelText(p.token),
      getSize: (p) => Math.max(13, Math.min(17, 11 + p.radius * 0.35)),
      getColor: [248, 248, 250, 255],
      getTextAnchor: "middle",
      getAlignmentBaseline: "bottom",
      fontFamily: '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
      fontWeight: 700,
      outlineWidth: 2.5,
      outlineColor: [12, 13, 16, 230],
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
      getColor: [180, 184, 194, 240],
      getTextAnchor: "middle",
      getAlignmentBaseline: "top",
      fontFamily: '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
      fontWeight: 600,
      outlineWidth: 2,
      outlineColor: [12, 13, 16, 210],
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
        style={{ position: "absolute", inset: "0" }}
        onDeviceInitialized={(device) => atlas.attach(device)}
        getCursor={({ isHovering }) => (isHovering ? "pointer" : "default")}
        onHover={({ object, x, y }) => {
          const token = pickedToken(object);
          setHover(token ? { token, x, y } : null);
        }}
        onClick={({ object }) => {
          if (!object) onSelect(null);
        }}
      />
      {hover && (
        <div
          className="map-tooltip"
          style={{ left: hover.x + 14, top: hover.y + 12 }}
          role="tooltip"
        >
          <div className="map-tooltip-head">
            <strong>{hover.token.symbol}</strong>
            {hover.token.status === "migrated" && <span className="tier-pill migrated">grad</span>}
          </div>
          <span className="map-tooltip-name">{hover.token.name}</span>
          <div className="map-tooltip-row">
            {formatUsdMoney(hover.token.marketCapUsd)}
            <span className={changeTone(hover.token)}>{formatLiveChange(hover.token)}</span>
          </div>
          <div className="map-tooltip-meta">
            {hover.token.status === "migrated" ? "migrated" : `${hover.token.curvePct}% curve`}
            {" · "}
            {formatAge(now - hover.token.createdAt)}
          </div>
          <div className="map-tooltip-mint">{shortMint(hover.token.token)}</div>
        </div>
      )}
    </div>
  );
}

function changeTone(token: Token): string {
  const change = liveChange(token);
  if (change === null) return "";
  return change >= 0 ? "up" : "down";
}

function pickedToken(object: unknown): Token | null {
  if (object === null || typeof object !== "object") return null;
  if ("iconId" in object) return (object as Placed).token;
  return object as Token;
}

function labelText(token: Token): string {
  return token.symbol.replace(/[^\x20-\x7e]/g, "").slice(0, 12) || "?";
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
  const gradY = yForCap(GRADUATE_MCAP_USD, view, config);

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
            grad
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

function shortMint(mint: string): string {
  if (mint.length < 10) return mint;
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}
