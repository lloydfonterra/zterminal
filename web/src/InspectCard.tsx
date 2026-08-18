import { useEffect, useState } from "react";
import type { Token } from "./types";
import { chartLabel, chartUrl, logoUrl, type ChartProvider } from "./iconAtlas";
import { formatAge, formatCurvePct, formatLiveChange, formatUsdMoney, liveChange } from "./scales";

interface Props {
  token: Token;
  now: number;
  chart: ChartProvider;
  x: number;
  y: number;
  onClose: () => void;
}

export function InspectCard({ token, now, chart, x, y, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const change = liveChange(token);
  const tone = change === null ? "" : change >= 0 ? "up" : "down";

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copyMint = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(token.token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  const open = (): void => {
    window.open(chartUrl(chart, token.token), "_blank", "noopener,noreferrer");
  };

  return (
    <aside className="inspect" style={{ left: x, top: y }} aria-label={`${token.symbol} details`}>
      <button type="button" className="inspect-close" onClick={onClose} aria-label="Deselect">
        ×
      </button>
      <div className="inspect-head">
        <img
          className="inspect-logo"
          src={logoUrl(token.token)}
          alt=""
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
        />
        <div className="inspect-id">
          <strong>{token.symbol}</strong>
          <span className="inspect-name">{token.name}</span>
        </div>
        {token.status === "migrated" ? (
          <span className="tier-pill migrated">grad</span>
        ) : (
          <span className="inspect-curve">{formatCurvePct(token.curvePct)} curve</span>
        )}
      </div>
      <div className="inspect-row">
        <span>{formatUsdMoney(token.marketCapUsd)}</span>
        <span className={tone}>{formatLiveChange(token)}</span>
        <span className="inspect-age">{formatAge(now - token.createdAt)}</span>
      </div>
      <div className="inspect-mint">
        <code>{shortMint(token.token)}</code>
        <button type="button" className="inspect-copy" onClick={() => void copyMint()}>
          {copied ? "copied" : "copy CA"}
        </button>
      </div>
      <button type="button" className="inspect-open" onClick={open}>
        Open {chartLabel(chart)}
      </button>
    </aside>
  );
}

function shortMint(mint: string): string {
  if (mint.length < 10) return mint;
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}
