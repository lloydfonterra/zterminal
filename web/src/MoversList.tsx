import type { Token } from "./types";
import { logoUrl } from "./iconAtlas";
import { formatCurvePct, formatLiveChange, formatUsdMoney, liveChange } from "./scales";

interface Props {
  tokens: Token[];
  selectedId: string | null;
  onSelect: (token: Token) => void;
}

const LIMIT = 16;

export function MoversList({ tokens, selectedId, onSelect }: Props) {
  const ranked = [...tokens]
    .sort(
      (a, b) =>
        (liveChange(b) ?? Number.NEGATIVE_INFINITY) - (liveChange(a) ?? Number.NEGATIVE_INFINITY),
    )
    .slice(0, LIMIT);

  return (
    <aside className="movers" aria-label="Top movers">
      <div className="movers-head">
        <span className="movers-title">movers</span>
      </div>

      <ul className="movers-list">
        {ranked.length === 0 && <li className="movers-empty">no tokens in window</li>}
        {ranked.map((token, i) => {
          const change = liveChange(token);
          const tone = change === null ? "" : change >= 0 ? "up" : "down";
          return (
            <li key={token.poolId}>
              <button
                type="button"
                className={token.poolId === selectedId ? "movers-row active" : "movers-row"}
                onClick={() => onSelect(token)}
              >
                <span className="movers-rank">{String(i + 1).padStart(2, "0")}</span>
                <img
                  className="movers-logo"
                  src={logoUrl(token.token)}
                  alt=""
                  onError={(e) => {
                    e.currentTarget.style.visibility = "hidden";
                  }}
                />
                <span className="movers-id">
                  <span className="movers-sym">{token.symbol.slice(0, 10)}</span>
                  <span className={`movers-flag ${token.status}`}>
                    {token.status === "migrated" ? "migrated" : formatCurvePct(token.curvePct)}
                  </span>
                </span>
                <span className="movers-mcap">{formatUsdMoney(token.marketCapUsd)}</span>
                <span className={`movers-chg ${tone}`}>{formatLiveChange(token)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
