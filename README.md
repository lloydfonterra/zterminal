# zTerminal

A live market map for **[pump.fun](https://pump.fun/)** launches on Solana — the same idea as
karta.markets. Every new coin is a bubble: age on X, log market cap on Y. Click opens pump.fun
(or axiom / photon / GMGN / bots).

```
npm install
npm run dev
```

Then open <http://localhost:5173>. No API key is required.

## How it works

```
pump.fun /coins     ──►  server  ──►  WebSocket  ──►  deck.gl bubble map
DexScreener prices          │          snapshot           x = age
                            └─ /icon proxy                y = log(USD mcap)
                               + delta
```

The server pages pump.fun's public coin list (last ~6h), refreshes the newest page every 2.5s,
and overlays DexScreener quotes so bubbles move.

Click-out is the v1 trade path. There is no in-app buy/sell panel.

## Layout

```
server/src/     poller, snapshot/delta feed, logo proxy
web/src/        deck.gl map, movers strip, search
```
