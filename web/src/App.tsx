import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MarketMap } from "./MarketMap";
import { MoversList } from "./MoversList";
import { useFeed } from "./useFeed";
import { CHART_PROVIDERS, PRIMARY_CHART_IDS, chartLabel, type ChartProvider } from "./iconAtlas";
import { graduateMcapUsd, type MapConfig } from "./scales";
import type { Token } from "./types";

const WINDOWS: Array<{ label: string; seconds: number }> = [
  { label: "5m", seconds: 300 },
  { label: "15m", seconds: 900 },
  { label: "30m", seconds: 1_800 },
  { label: "1h", seconds: 3_600 },
  { label: "6h", seconds: 21_600 },
];

const CAP_RANGES: Array<{ label: string; minUsd: number; maxUsd: number }> = [
  { label: "250–10K", minUsd: 250, maxUsd: 10_000 },
  { label: "1K–50K", minUsd: 1_000, maxUsd: 50_000 },
  { label: "1K–100K", minUsd: 1_000, maxUsd: 100_000 },
  { label: "5K–200K", minUsd: 5_000, maxUsd: 200_000 },
  { label: "all", minUsd: 250, maxUsd: 1_000_000 },
];

const STATUSES: Array<{ label: string; value: "all" | "on_curve" | "migrated" }> = [
  { label: "all", value: "all" },
  { label: "curve", value: "on_curve" },
  { label: "migrated", value: "migrated" },
];


export default function App() {
  const { tokens, solPriceUsd, status, setWatchMints } = useFeed();
  const [windowIndex, setWindowIndex] = useState(1);
  const [capIndex, setCapIndex] = useState(1);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUSES)[number]["value"]>("all");
  const [chart, setChart] = useState<ChartProvider>("pumpfun");
  const [moreOpen, setMoreOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [clock, setClock] = useState(() => formatClock(new Date()));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      const date = new Date();
      setClock(formatClock(date));
      setNow(date.getTime());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const config: MapConfig = useMemo(() => {
    const win = WINDOWS[windowIndex] ?? WINDOWS[1]!;
    const cap = CAP_RANGES[capIndex] ?? CAP_RANGES[1]!;
    return {
      windowSeconds: win.seconds,
      minCapUsd: cap.minUsd,
      maxCapUsd: cap.maxUsd,
      graduateMcapUsd: graduateMcapUsd(solPriceUsd),
    };
  }, [windowIndex, capIndex, solPriceUsd]);

  const inWindow = useMemo(() => {
    const cutoff = now - config.windowSeconds * 1000;
    return tokens.filter((t) => {
      if (t.createdAt < cutoff) return false;
      if (t.marketCapUsd < config.minCapUsd || t.marketCapUsd > config.maxCapUsd) return false;
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      return true;
    });
  }, [tokens, config, statusFilter, now]);

  useEffect(() => {
    const mints = inWindow.map((t) => t.poolId);
    if (selectedId && !mints.includes(selectedId)) mints.push(selectedId);
    if (focusId && !mints.includes(focusId)) mints.push(focusId);
    setWatchMints(mints);
  }, [inWindow, selectedId, focusId, setWatchMints]);

  const graduated = inWindow.filter((t) => t.status === "migrated").length;
  const aboveGrad = inWindow.filter((t) => t.marketCapUsd >= config.graduateMcapUsd).length;
  const primaryCharts = CHART_PROVIDERS.filter((c) => PRIMARY_CHART_IDS.includes(c.id));
  const extraCharts = CHART_PROVIDERS.filter((c) => !PRIMARY_CHART_IDS.includes(c.id));
  const extraActive = extraCharts.some((c) => c.id === chart);

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
            <span className="chain">pump.fun</span>
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
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setSearch("");
                }
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
            <Metric label="graduated" value={String(graduated)} />
            <Metric label="above grad" value={String(aboveGrad)} tone="up" />
            <Metric
              label="SOL"
              value={
                solPriceUsd > 0
                  ? `$${solPriceUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                  : "—"
              }
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
          <div className="group group-openin">
            <span className="group-label">open in</span>
            <div className="seg">
              {primaryCharts.map((c) => (
                <button
                  key={c.id}
                  className={c.id === chart ? "chip active" : "chip"}
                  onClick={() => {
                    setChart(c.id);
                    setMoreOpen(false);
                  }}
                >
                  {c.label}
                </button>
              ))}
              <div className="open-more">
                <button
                  type="button"
                  className={moreOpen || extraActive ? "chip active" : "chip"}
                  onClick={() => setMoreOpen((open) => !open)}
                >
                  {extraActive ? chartLabel(chart) : "more"}
                </button>
                {moreOpen && (
                  <div className="open-more-menu">
                    {extraCharts.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className={c.id === chart ? "chip active" : "chip"}
                        onClick={() => {
                          setChart(c.id);
                          setMoreOpen(false);
                        }}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
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
        <MoversList tokens={inWindow} selectedId={selectedId} onSelect={jumpTo} />
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
          <i className="dot graduated" /> graduated
        </span>
        <span className="hint">
          Hover a bubble · click to inspect · copy CA · Open {chartLabel(chart)}
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
