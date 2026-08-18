import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

const SHOWS: Array<{ label: string; value: "all" | "socials" | "hide_farm" }> = [
  { label: "all", value: "all" },
  { label: "socials", value: "socials" },
  { label: "hide ×5+", value: "hide_farm" },
];

const FARM_MIN = 5;


export default function App() {
  const { tokens, solPriceUsd, status, setWatchMints, upsertToken } = useFeed();
  const [windowIndex, setWindowIndex] = useState(1);
  const [capIndex, setCapIndex] = useState(1);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUSES)[number]["value"]>("all");
  const [showFilter, setShowFilter] = useState<(typeof SHOWS)[number]["value"]>("all");
  const [chart, setChart] = useState<ChartProvider>("pumpfun");
  const [moreOpen, setMoreOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [copiedToast, setCopiedToast] = useState<string | null>(null);
  const [lookup, setLookup] = useState<"idle" | "loading" | "miss">("idle");
  const lookupBusy = useRef(false);
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

  const creatorCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const token of tokens) {
      const creator = token.creator;
      if (!creator) continue;
      counts.set(creator, (counts.get(creator) ?? 0) + 1);
    }
    return counts;
  }, [tokens]);

  const inWindow = useMemo(() => {
    const cutoff = now - config.windowSeconds * 1000;
    return tokens.filter((t) => {
      if (t.createdAt < cutoff) return false;
      if (t.marketCapUsd < config.minCapUsd || t.marketCapUsd > config.maxCapUsd) return false;
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (showFilter === "socials" && !hasSocials(t)) return false;
      if (showFilter === "hide_farm") {
        const n = t.creator ? (creatorCounts.get(t.creator) ?? 0) : 0;
        if (n >= FARM_MIN) return false;
      }
      return true;
    });
  }, [tokens, config, statusFilter, showFilter, creatorCounts, now]);

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
    return [...tokens]
      .filter((t) => searchScore(t, q) < 9)
      .sort((a, b) => searchScore(a, q) - searchScore(b, q) || b.marketCapUsd - a.marketCapUsd)
      .slice(0, 8);
  }, [search, tokens]);

  const searchQuery = search.trim();
  const exactMint = useMemo(() => {
    if (!isSolanaMint(searchQuery)) return null;
    const q = searchQuery.toLowerCase();
    return tokens.find((t) => t.token.toLowerCase() === q) ?? null;
  }, [searchQuery, tokens]);
  const canLookup = isSolanaMint(searchQuery) && !exactMint;

  const inIds = useMemo(() => new Set(inWindow.map((t) => t.poolId)), [inWindow]);

  const mapTokens = useMemo(() => {
    const extra = tokens.filter((t) => t.poolId === selectedId || t.poolId === focusId);
    if (extra.length === 0) return inWindow;
    const seen = new Set(inWindow.map((t) => t.poolId));
    const missing = extra.filter((t) => !seen.has(t.poolId));
    return missing.length === 0 ? inWindow : [...inWindow, ...missing];
  }, [inWindow, tokens, selectedId, focusId]);

  const copyCa = (token: Token): void => {
    void navigator.clipboard.writeText(token.token).then(
      () => {
        setCopiedToast(token.symbol);
        window.setTimeout(() => setCopiedToast(null), 1200);
      },
      () => setCopiedToast(null),
    );
  };

  const pickToken = (token: Token): void => {
    setSelectedId(token.poolId);
    setFocusId(token.poolId);
    copyCa(token);
  };

  const jumpTo = (token: Token): void => {
    setSelectedId(token.poolId);
    setFocusId(token.poolId);
    setInspectId(token.poolId);
    setSearch("");
    setLookup("idle");
    copyCa(token);
  };

  const lookupCa = async (mint: string): Promise<void> => {
    if (lookupBusy.current) return;
    lookupBusy.current = true;
    setLookup("loading");
    try {
      const res = await fetch(`/coin/${encodeURIComponent(mint)}`);
      const body = (await res.json()) as { ok?: boolean; token?: Token };
      if (!res.ok || !body.ok || !body.token) {
        setLookup("miss");
        return;
      }
      upsertToken(body.token);
      jumpTo(body.token);
    } catch {
      setLookup("miss");
    } finally {
      lookupBusy.current = false;
    }
  };

  const submitSearch = (): void => {
    const q = search.trim();
    if (exactMint) {
      jumpTo(exactMint);
      return;
    }
    if (isSolanaMint(q)) {
      void lookupCa(q);
      return;
    }
    if (searchHits[0]) jumpTo(searchHits[0]);
  };

  const pickFromList = (token: Token): void => {
    setSelectedId(token.poolId);
    setFocusId(token.poolId);
    setInspectId(token.poolId);
    copyCa(token);
  };

  const clearPick = (): void => {
    setSelectedId(null);
    setFocusId(null);
    setInspectId(null);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "i" && event.key !== "I") return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (!selectedId) return;
      event.preventDefault();
      setInspectId((id) => (id === selectedId ? null : selectedId));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId]);

  return (
    <div className="app">
      <header className="chrome">
        <div className="bar bar-top">
          <div className="brand" aria-label="zTerminal">
            <span className="brand-mark">z</span>
            <span className="brand-name">Terminal</span>
            <span className="brand-cursor" aria-hidden="true">
              █
            </span>
            <span className="chain">pump.fun</span>
          </div>

          <a
            className="brand-x"
            href="https://x.com/zTerminalz"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="zTerminal on X"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path
                fill="currentColor"
                d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.727-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117z"
              />
            </svg>
          </a>

          <div className="search">
            <input
              type="search"
              className="search-input"
              placeholder="> ticker / mint / CA"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setLookup("idle");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitSearch();
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setSearch("");
                  setLookup("idle");
                }
              }}
              aria-label="Search tokens"
            />
            {search.trim() && (
              <ul className="search-results">
                {searchHits.length === 0 && !canLookup && (
                  <li className="search-empty">no hits</li>
                )}
                {searchHits.map((t) => (
                  <li key={t.poolId}>
                    <button type="button" onClick={() => jumpTo(t)}>
                      <span className="search-sym">{t.symbol}</span>
                      <span className="search-name">{t.name}</span>
                      {!inIds.has(t.poolId) && <span className="search-out">out</span>}
                    </button>
                  </li>
                ))}
                {canLookup && (
                  <li>
                    <button
                      type="button"
                      onClick={() => void lookupCa(searchQuery)}
                      disabled={lookup === "loading"}
                    >
                      <span className="search-sym">
                        {lookup === "loading" ? "…" : "lookup"}
                      </span>
                      <span className="search-name">{shortMint(searchQuery)}</span>
                      {lookup === "miss" && <span className="search-out">not found</span>}
                    </button>
                  </li>
                )}
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
          <Segment label="show">
            {SHOWS.map((s) => (
              <button
                key={s.value}
                className={s.value === showFilter ? "chip active" : "chip"}
                onClick={() => setShowFilter(s.value)}
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
          tokens={mapTokens}
          allTokens={tokens}
          config={config}
          chart={chart}
          selectedId={selectedId}
          inspectId={inspectId}
          focusId={focusId}
          onSelect={(id) => {
            if (!id) {
              clearPick();
              return;
            }
            const token = tokens.find((t) => t.poolId === id);
            if (token) pickToken(token);
          }}
          onInspectClose={() => setInspectId(null)}
        />
        <MoversList
          tokens={inWindow}
          selectedId={selectedId}
          creatorCounts={creatorCounts}
          onSelect={pickFromList}
        />
      </div>

      <footer className="legend">
        <span className="legend-brand">zterminal</span>
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
        <span>
          <i className="dot family" /> same dev
        </span>
        <span className="hint">
          Hover for details · click copies CA · Open {chartLabel(chart)}
        </span>
        <time className="clock" dateTime={new Date().toISOString()}>
          {clock}
        </time>
      </footer>
      {copiedToast && (
        <div className="copy-toast" role="status">
          copied {copiedToast}
        </div>
      )}
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

function hasSocials(token: Token): boolean {
  return Boolean(token.twitter || token.telegram || token.website);
}

function isSolanaMint(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.trim());
}

function shortMint(mint: string): string {
  const value = mint.trim();
  if (value.length < 10) return value;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function searchScore(token: Token, q: string): number {
  const symbol = token.symbol.toLowerCase();
  const name = token.name.toLowerCase();
  const mint = token.token.toLowerCase();
  if (symbol === q || mint === q) return 0;
  if (symbol.startsWith(q) || mint.startsWith(q)) return 1;
  if (symbol.includes(q) || name.includes(q) || mint.includes(q)) return 2;
  return 9;
}
