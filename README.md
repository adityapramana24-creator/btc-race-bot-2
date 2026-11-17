# btc-race-bot-2

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/adityapramana24-creator/btc-race-bot-2/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/adityapramana24-creator/btc-race-bot-2/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

A BTC trading bot for make.fun's `btc-race-24h-20261117-0603` bounty. It trades
Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute on-chain bars, long only,
starting from 1,000 USDC of paper money, through the
`agent-fun/bars-replay/v1` protocol (Node 22, `node /bot/main.ts`).

It descends from the tiered-washout bot of the previous instance
(`btc-race-24h-20261115-0828`, server dev grade +$49.40, rank 168/2,840). That
bot, run unchanged on this instance's dev window, LOSES -$2.42: this window is
calm and range-bound (overall +0.49%, max drawdown -2.12%, the deepest 120-bar
fall only -1.37%), so its -2% washout trigger never fires and its one momentum
trade loses. This version adds a trend-filtered small-dip leg for calm windows,
keeps the big-washout leg for windows that do wash out, and drops momentum
entirely (after a +1% rise over 30 bars this window falls on average, so buying
surges is buying tops).

## Strategy

- **Small-dip leg (mean reversion, trend-filtered):** when the close first
  falls 1% below the close 60 bars ago AND the 6-hour trend is not down (close
  no more than 1% below the close 360 bars ago), buy with 50% of cash, single
  tranche — no averaging down, since small dips in a turn keep falling. On this
  dev window, after a -1% fall over 60 bars the next 120 bars average +0.66%
  (7/7 winning). Exit: take profit at +1.2% over the average entry cost
  (fill-based, fees included); a trailing stop of 0.5% below the peak close,
  armed once the peak gain reaches +0.6%; a stop-loss at -1.5%; and a 120-bar
  maximum hold.
- **Big-dip leg (tiered washout, unchanged):** when the close first falls 2%
  below the close 120 bars ago, buy with 40% of cash. While holding, if the
  close falls further to 2.6% below the close 120 bars ago, buy with the
  remaining cash. Exit: take profit at +4.5%; trailing stop 1% below the peak,
  armed at +3%; stop-loss -2%; 180-bar maximum hold. This leg never fires on
  this dev window; it is insurance for race windows that wash out, where it is
  the proven earner (+$46.49 on the previous window's hour-17 washout).
- **Cooldown:** 60 bars after every exit before a signal leg may enter again,
  so the bot never re-buys into the same falling move.
- **Fallback:** if no order has ever filled by bar 1200, buy 25% of cash and
  sell 60 bars later, so the entry still meets the 1-trade guardrail on a
  window too calm for either signal leg.

Tested and rejected on the dev windows: the previous bot unchanged (-$2.42 on
this window); momentum-chasing (+1%/30 bars, negative forward returns at every
horizon here); small-dip take-profits of +0.8% (+$5.08) and +1.5% (+$5.82),
both below the +1.2% level (+$7.59); and unfiltered small-dip buying, which
loses on the previous downtrending window (+60 bars average -0.50%, 8/19
stopped out) — the 6-hour trend filter blocks 16 of its 19 dip events there.

## Layout

- `main.ts` — the entrypoint: the strategy, written against the SDK shim.
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's TypeScript SDK
  shim (`sdk/makefun-bars.ts`).

Deterministic: every decision is a pure function of the closes and fills seen
so far (no wall clock, no randomness, no environment). Position state comes
from the fills each batch reports, so a rejected order never desyncs the bot.

## Run it

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot <this-repo> --driver process
```

## Local grade

Dev window, `grade-local --driver process`, verified twice with byte-identical
action logs (`a3dbc424…`):

- Net PnL **+7.592273 USDC** (+0.76%)
- 6 trades, 3 round trips, win rate 0.667, 0 rejected
- Max drawdown 0.3312%, guardrails met
- Net PnL at 2x fees +6.382586 USDC

Per-trade (from the grader's per-hour blocks): bar 373 dip-buy +$2.14
(max-hold exit), bar 570 dip-buy +$6.09 (take-profit +1.2%), bar 1096 dip-buy
-$0.65 (max-hold exit). The PnL is spread across hours 6–11, not one event.

Cross-check on the previous instance's dev window (2026-11-15, -4% downtrend):
net PnL **+44.750441 USDC**, 10 trades, win rate 0.75, +42.322141 USDC at 2x
fees — the small-dip leg costs $2.45 there and dropping momentum costs $2.20,
against the washout leg's +$46.49.

The small-dip edge rests on 7 events in one calm window, so its size is
uncertain; the trend filter and the single tranche are what keep it from
becoming a falling-knife buyer on a downtrending race window. The take-profit
choice between +1.0% (+$5.85) and +1.2% (+$7.59) rests on one trade's path.
What the race window pays depends on which regime it is in.

License: MIT (see `LICENSE`).

---

<sub>Entered on [make.fun](https://make.fun/?ref=5435dmkf&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>
