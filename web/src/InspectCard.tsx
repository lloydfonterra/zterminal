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
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  devCount?: number;
}

export function InspectCard({
  token,
  now,
  chart,
  x,
  y,
  onClose,
  onMouseEnter,
  onMouseLeave,
  devCount = 0,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [mentions, setMentions] = useState<CaMention[]>([]);
  const [mentionStatus, setMentionStatus] = useState<"idle" | "loading" | "ok" | "limited" | "error">("idle");
  const change = liveChange(token);
  const tone = change === null ? "" : change >= 0 ? "up" : "down";

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const ac = new AbortController();
    setMentions([]);
    setMentionStatus("loading");
    const timer = window.setTimeout(() => {
      void fetch(`/mentions/${encodeURIComponent(token.token)}?since=${token.createdAt}`, {
        signal: ac.signal,
      })
        .then(
          (res) =>
            res.json() as Promise<{
              ok?: boolean;
              status?: string;
              mentions?: CaMention[];
            }>,
        )
        .then((body) => {
          const rows = Array.isArray(body.mentions) ? body.mentions.slice(0, 3) : [];
          setMentions(rows);
          if (body.status === "limited") setMentionStatus("limited");
          else if (body.status === "error") setMentionStatus("error");
          else setMentionStatus("ok");
        })
        .catch(() => {
          if (!ac.signal.aborted) {
            setMentions([]);
            setMentionStatus("error");
          }
        });
    }, 700);
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [token.token, token.createdAt]);

  const socials: { label: string; href: string }[] = [];
  if (token.twitter) socials.push({ label: "X", href: token.twitter });
  if (token.telegram) socials.push({ label: "TG", href: token.telegram });
  if (token.website) socials.push({ label: "web", href: token.website });

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
    <aside
      className="inspect"
      style={{ left: x, top: y }}
      aria-label={`${token.symbol} details`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="inspect-chrome">
        inspect
        <span className="inspect-chrome-id">{token.symbol}</span>
      </div>
      <button type="button" className="inspect-close" onClick={onClose} aria-label="Close inspect">
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
        {devCount >= 2 && <span className="tier-pill family">dev ×{devCount}</span>}
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
      {socials.length > 0 && (
        <div className="inspect-socials">
          {socials.map((item) => (
            <a
              key={item.label}
              className="inspect-social"
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {item.label}
            </a>
          ))}
        </div>
      )}
      {(mentionStatus === "loading" || mentionStatus === "limited" || mentionStatus === "error" || mentions.length > 0) && (
        <div className="inspect-mentions">
          <div className="inspect-mentions-label">on x</div>
          {mentionStatus === "loading" && <div className="inspect-mention-empty">looking…</div>}
          {mentionStatus === "limited" && <div className="inspect-mention-empty">x busy — hold one coin</div>}
          {mentionStatus === "error" && mentions.length === 0 && (
            <div className="inspect-mention-empty">x search failed</div>
          )}
          {mentions.map((mention) => (
            <a
              key={mention.tweetId}
              className="inspect-mention"
              href={mention.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="inspect-mention-meta">
                <span className="inspect-mention-handle">@{mention.handle}</span>
                <span className="inspect-mention-age">{formatAge(now - mention.createdAt)}</span>
              </span>
              {mention.text ? <span className="inspect-mention-text">{mention.text}</span> : null}
            </a>
          ))}
        </div>
      )}
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

interface CaMention {
  handle: string;
  name: string;
  tweetId: string;
  createdAt: number;
  url: string;
  text?: string;
}
