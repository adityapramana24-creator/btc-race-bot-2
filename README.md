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
trade loses. The v3 two-scale dip bot fixed the signal (trend-filtered
small-dip leg, +$7.59) but traded only 3 round trips at 50% of cash with a
120-bar hold — its first trade exited on the hold clock just before the +2.32%
snap-back leg. This v4 keeps v3's signal and fixes its size and patience:
full-size entries (100% of cash) and a 195-bar hold, so a dip-buy can ride a
recovery to its take-profit instead of being cut off by the clock. Momentum
stays deleted (after a +1% rise over 30 bars this window falls on average, so
buying surges is buying tops).

## Strategy

- **Small-dip leg (mean reversion, trend-filtered):** when the close first
  falls 1% below the close 60 bars ago AND the 6-hour trend is not down (close
  no more than 1% below the close 360 bars ago), buy with ALL the cash, single
  tranche — no averaging down, since small dips in a turn keep falling. On this
  dev window, after a -1% fall over 60 bars the next 120 bars average +0.66%
  (7/7 winning). Exit: take profit at +1.2% over the average entry cost
  (fill-based, fees included); a trailing stop of 0.5% below the peak close,
  armed once the peak gain reaches +0.6%; a stop-loss at -1.5%; and a 195-bar
  maximum hold.
- **Big-dip leg (tiered washout, unchanged):** when the close first falls 2%
  below the close 120 bars ago, buy with 40% of cash. While holding, if the
  close falls further to 2.6% below the close 120 bars ago, buy with the
  remaining cash. Exit: take profit at +4.5%; trailing stop 1% below the peak,
  armed at +3%; stop-loss -2%; 180-bar maximum hold. This leg never fires on
  this dev window; it is insurance for race windows that wash out, where it is
  the proven earner (+$46.49 on the previous window's hour-17 washout).
- **Cooldown:** 30 bars after every exit before a signal leg may enter again,
  so the bot never re-buys into the same falling move.
- **Fallback:** if no order has ever filled by bar 1200, buy 25% of cash and
  sell 60 bars later, so the entry still meets the 1-trade guardrail on a
  window too calm for either signal leg.

Tested and rejected on BOTH dev windows (each variant graded locally on the new
window and on the previous instance's -4% downtrend window; only changes that
improved the new window without breaking the old one were kept): shallower dip
thresholds (-0.6%/-0.8% over 60 bars — fire earlier into a dip, worse entries);
rolling-high triggers, RSI triggers and fast-drop capitulation triggers (all
fire earlier than the -1%/60-bar drop and all score worse; RSI <= 35/40 loses
outright); two-stage entries and scale-in second tranches (the deepening leg
never fires on this window, so the bot just trades smaller); shorter trend
filters (block good trades, add none); higher take-profits (+1.4% to +2.0% —
the +1.2% level is the one both big winners reach); higher big-dip take-profit
(+5.5%/+6.0% — gives the washout gain back to the trailing stop); shorter holds
(60/90/120 bars cut the first trade off before the snap-back). Holds of 150–240
bars form a plateau on the new window and up to 210 bars on the old one; 195
bars sits in the middle of it on both. The previous bot unchanged (-$2.42 on
this window) and unfiltered small-dip buying (loses on the downtrend window)
were already rejected for v3.

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
action logs (`c27cade5…`):

- Net PnL **+30.316761 USDC** (+3.03%)
- 6 trades, 3 round trips, win rate 1.0, 0 rejected
- Max drawdown 0.7237%, guardrails met
- Net PnL at 2x fees +27.854416 USDC

Per-trade (screening simulator, within $2 of the grader): bar 373 dip-buy
+$13.88 (take-profit +1.2% at bar 510, riding the +2.32% snap-back leg), bar 570
dip-buy +$11.10 (take-profit), bar 1096 dip-buy +$3.55 (max-hold exit). Two of
the three round trips exit on the same +1.2% take-profit.

Cross-check on the previous instance's dev window (2026-11-15, -4% downtrend):
net PnL **+41.361300 USDC**, 10 trades, win rate 0.75, +38.540239 USDC at 2x
fees, guardrails met (action log `37b345f9…`) — the small-dip leg costs $7.77
there (one filtered-in loser, smaller than v3's $11.43 at full size because the
longer hold lets it recover partway), against the washout leg's +$46.62.

The new-window profit rests on 3 dip events in one calm window, so its size is
uncertain; the trend filter and the single tranche are what keep it from
becoming a falling-knife buyer on a downtrending race window. What is robust is
the shape, not the number: full-size entries into late, sustained dips with a
trend filter, a reachable take-profit, and a hold long enough for a 2–3 hour
recovery — profitable on a calm window (+$30.32) and on a -4% downtrend
(+$41.36), at doubled fees on both. What the race window pays depends on which
regime it is in.

License: MIT (see `LICENSE`).

---

<sub>Entered on [make.fun](https://make.fun/?ref=5435dmkf&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>
