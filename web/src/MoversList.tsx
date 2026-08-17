import type { Token } from "./types";
import { logoUrl } from "./iconAtlas";
import { formatUsdMoney, tokenTier } from "./scales";

export type MoversSort = "climbers" | "volume";

interface Props {
  tokens: Token[];
  selectedId: string | null;
  sort: MoversSort;
  onSort: (sort: MoversSort) => void;
  onSelect: (token: Token) => void;
}

const LIMIT = 16;

export function MoversList({ tokens, selectedId, sort, onSort, onSelect }: Props) {
  const ranked = [...tokens]
    .sort((a, b) =>
      sort === "climbers"
        ? changeOf(b) - changeOf(a)
        : b.volumeUsd24h - a.volumeUsd24h,
    )
    .slice(0, LIMIT);

  return (
    <aside className="movers" aria-label="Top movers">
      <div className="movers-head">
        <span className="movers-title">movers</span>
        <div className="seg">
          <button
            type="button"
            className={sort === "climbers" ? "chip active" : "chip"}
            onClick={() => onSort("climbers")}
          >
            %
          </button>
          <button
            type="button"
            className={sort === "volume" ? "chip active" : "chip"}
            onClick={() => onSort("volume")}
          >
            vol
          </button>
        </div>
      </div>

      <ul className="movers-list">
        {ranked.length === 0 && <li className="movers-empty">no tokens in window</li>}
        {ranked.map((token, i) => {
          const change = changeOf(token);
          const up = change >= 0;
          const tier = tokenTier(token);
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
                  <span className={`movers-flag ${token.status} ${tier}`}>
                    {tier !== "free" ? `${tier} · ` : ""}
                    {token.status === "migrated" ? "migrated" : `${token.curvePct}%`}
                  </span>
                </span>
                <span className="movers-mcap">{formatUsdMoney(token.marketCapUsd)}</span>
                <span className={`movers-chg ${up ? "up" : "down"}`}>
                  {up ? "+" : ""}
                  {(change * 100).toFixed(1)}%
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function changeOf(token: Token): number {
  return token.change5m !== 0 ? token.change5m : token.change24h;
}
