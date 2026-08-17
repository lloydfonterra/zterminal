# zTerminal

A live market map for **[ansem.io](https://ansem.io/)** launches on Solana. Every coin on the
launchpad is drawn as a bubble: horizontal position is age, vertical position is market cap on a
log scale. Click a bubble to open it on ansem.io (or pump.fun / GMGN).

This is the same map idea as karta.markets / hoodmap. The feed is ansem.io's public coin list —
real Pump.fun tokens, wrapped with tier, curve progress, and community-airdrop state.

```
npm install
npm run dev
```

Then open <http://localhost:5173>. No API key is required.

## How it works

```
ansem.io /api/coins  ──►  server  ──►  WebSocket  ──►  deck.gl bubble map
ansem.io /api/market        │          snapshot           x = age
                            └─ /icon proxy                y = log(USD mcap)
                               + delta
```

The site does not publish a market-wide live stream (its socket is per-mint trades). The server
polls `/api/coins` every 2.5s, keeps a 5-minute price history so bubbles can colour by recent
move, and pushes the same snapshot/delta protocol the original terminal used.

Click-out is the v1 trade path. There is no in-app buy/sell panel.

## Layout

```
server/src/     poller, snapshot/delta feed, logo proxy
web/src/        deck.gl map, movers strip, search
```
