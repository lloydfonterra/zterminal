import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MarketMap } from "./MarketMap";
import { MoversList, type MoversSort } from "./MoversList";
import { useFeed } from "./useFeed";
import { CHART_PROVIDERS, chartLabel, type ChartProvider } from "./iconAtlas";
import { tokenTier, type MapConfig } from "./scales";
import type { Token } from "./types";

const WINDOWS: Array<{ label: string; seconds: number }> = [
  { label: "15m", seconds: 900 },
  { label: "1h", seconds: 3600 },
  { label: "6h", seconds: 21_600 },
  { label: "24h", seconds: 86_400 },
];

const CAP_RANGES: Array<{ label: string; minUsd: number; maxUsd: number }> = [
  { label: "1K–50K", minUsd: 1_000, maxUsd: 50_000 },
  { label: "1K–500K", minUsd: 1_000, maxUsd: 500_000 },
  { label: "2K–1M", minUsd: 2_000, maxUsd: 1_000_000 },
];

const STATUSES: Array<{ label: string; value: "all" | "on_curve" | "migrated" }> = [
  { label: "all", value: "all" },
  { label: "curve", value: "on_curve" },
  { label: "migrated", value: "migrated" },
];


export default function App() {
  const { tokens, solPriceUsd, ansemPriceUsd, status, setWatchMints } = useFeed();
  const [windowIndex, setWindowIndex] = useState(2);
  const [capIndex, setCapIndex] = useState(1);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUSES)[number]["value"]>("all");
  const [chart, setChart] = useState<ChartProvider>("ansem");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [moversSort, setMoversSort] = useState<MoversSort>("climbers");
  const [clock, setClock] = useState(() => formatClock(new Date()));

  useEffect(() => {
    const timer = window.setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const config: MapConfig = useMemo(() => {
    const win = WINDOWS[windowIndex] ?? WINDOWS[2]!;
    const cap = CAP_RANGES[capIndex] ?? CAP_RANGES[1]!;
    return {
      windowSeconds: win.seconds,
      minCapUsd: cap.minUsd,
      maxCapUsd: cap.maxUsd,
    };
  }, [windowIndex, capIndex]);

  const inWindow = useMemo(() => {
    const cutoff = Date.now() - config.windowSeconds * 1000;
    return tokens.filter((t) => {
      if (t.createdAt < cutoff) return false;
      if (t.marketCapUsd < config.minCapUsd || t.marketCapUsd > config.maxCapUsd) return false;
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      return true;
    });
  }, [tokens, config, statusFilter]);

  useEffect(() => {
    const mints = inWindow.map((t) => t.poolId);
    if (selectedId && !mints.includes(selectedId)) mints.push(selectedId);
    if (focusId && !mints.includes(focusId)) mints.push(focusId);
    setWatchMints(mints);
  }, [inWindow, selectedId, focusId, setWatchMints]);

  const climbing = inWindow.filter((t) => (t.change5m || t.change24h) > 0.05).length;
  const migrated = inWindow.filter((t) => t.status === "migrated").length;
  const goldCount = inWindow.filter((t) => tokenTier(t) === "gold").length;
  const diamondCount = inWindow.filter((t) => tokenTier(t) === "diamond").length;

  const searchHits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [] as Token[];
    return inWindow
      .filter(
        (t) =>
          t.symbol.toLowerCase().includes(q) ||
          t.name.toLowerCase().includes(q) ||
          t.token.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [search, inWindow]);

  const jumpTo = (token: Token): void => {
    setSelectedId(token.poolId);
    setFocusId(token.poolId);
    setSearch("");
  };

  return (
    <div className="app">
      <header className="chrome">
        <div className="bar bar-top">
          <div className="brand" aria-label="zTerminal">
            <span className="brand-mark">z</span>
            <span className="brand-name">Terminal</span>
            <span className="chain">ansem.io</span>
          </div>

          <div className="search">
            <input
              type="search"
              className="search-input"
              placeholder="Search ticker or mint"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchHits[0]) jumpTo(searchHits[0]);
                if (e.key === "Escape") setSearch("");
              }}
              aria-label="Search tokens"
            />
            {search.trim() && (
              <ul className="search-results">
                {searchHits.length === 0 && <li className="search-empty">no matches</li>}
                {searchHits.map((t) => (
                  <li key={t.poolId}>
                    <button type="button" onClick={() => jumpTo(t)}>
                      <span className="search-sym">{t.symbol}</span>
                      <span className="search-name">{t.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="metrics">
            <Metric label="coins" value={String(inWindow.length)} />
            <Metric label="climbing" value={String(climbing)} tone="up" />
            <Metric label="migrated" value={String(migrated)} />
            {goldCount > 0 && <Metric label="gold" value={String(goldCount)} />}
            {diamondCount > 0 && <Metric label="diamond" value={String(diamondCount)} />}
            <Metric
              label="SOL"
              value={
                solPriceUsd > 0
                  ? `$${solPriceUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  : "—"
              }
            />
            <Metric
              label="$ANSEM"
              value={ansemPriceUsd > 0 ? `$${ansemPriceUsd.toFixed(2)}` : "—"}
            />
            <span className={`status ${status}`}>
              <i className="status-dot" />
              {status}
            </span>
          </div>
        </div>

        <div className="bar bar-filters">
          <Segment label="window">
            {WINDOWS.map((w, i) => (
              <button
                key={w.label}
                className={i === windowIndex ? "chip active" : "chip"}
                onClick={() => setWindowIndex(i)}
              >
                {w.label}
              </button>
            ))}
          </Segment>
          <Segment label="mcap">
            {CAP_RANGES.map((c, i) => (
              <button
                key={c.label}
                className={i === capIndex ? "chip active" : "chip"}
                onClick={() => setCapIndex(i)}
              >
                {c.label}
              </button>
            ))}
          </Segment>
          <Segment label="status">
            {STATUSES.map((s) => (
              <button
                key={s.value}
                className={s.value === statusFilter ? "chip active" : "chip"}
                onClick={() => setStatusFilter(s.value)}
              >
                {s.label}
              </button>
            ))}
          </Segment>
          <Segment label="open in" wrap>
            {CHART_PROVIDERS.map((c) => (
              <button
                key={c.id}
                className={c.id === chart ? "chip active" : "chip"}
                onClick={() => setChart(c.id)}
              >
                {c.label}
              </button>
            ))}
          </Segment>
        </div>
      </header>

      <div className="workspace">
        <MarketMap
          tokens={inWindow}
          config={config}
          chart={chart}
          selectedId={selectedId}
          focusId={focusId}
          onSelect={(id) => {
            setSelectedId(id);
            setFocusId(id);
          }}
        />
        <MoversList
          tokens={inWindow}
          selectedId={selectedId}
          sort={moversSort}
          onSort={setMoversSort}
          onSelect={jumpTo}
        />
      </div>

      <footer className="legend">
        <span className="legend-brand">zTerminal</span>
        <span>
          <i className="dot up" /> gaining
        </span>
        <span>
          <i className="dot down" /> losing
        </span>
        <span>
          <i className="dot flat" /> flat
        </span>
        <span>
          <i className="dot gold" /> gold
        </span>
        <span>
          <i className="dot diamond" /> diamond
        </span>
        <span className="hint">
          Hover a bubble · click opens {chartLabel(chart)} · search or movers to jump
        </span>
        <time className="clock" dateTime={new Date().toISOString()}>
          {clock}
        </time>
      </footer>
    </div>
  );
}

function Segment({
  label,
  children,
  wrap = false,
}: {
  label: string;
  children: ReactNode;
  wrap?: boolean;
}) {
  return (
    <div className={wrap ? "group group-open" : "group"}>
      <span className="group-label">{label}</span>
      <div className={wrap ? "seg wrap" : "seg"}>{children}</div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "up" }) {
  return (
    <span className="metric">
      <span className="metric-label">{label}</span>
      <span className={tone === "up" ? "metric-value up" : "metric-value"}>{value}</span>
    </span>
  );
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
