// Two-scale dip bot for make.fun btc-race-24h-20261117-0603.
//
// The bot trades one symbol (CBBTC vs USDC) on 1-minute bars, long only, through
// the agent-fun/bars-replay/v1 protocol: the harness sends hello once, then one
// batch per minute, and this bot answers every batch with exactly one reply.
//
// Lineage: this descends from the tiered-washout bot that won the dev gate on
// the previous instance of this competition (btc-race-24h-20261115-0828, server
// dev grade +$49.40, rank 168/2,840). That bot, run unchanged on THIS instance's
// dev window (2026-11-16T06:03Z to 2026-11-17T06:03Z, 1,440 bars), LOSES
// -$2.42: this window is calm and range-bound (overall +0.49%, max drawdown
// -2.12%, the deepest 120-bar fall only -1.37%), so its -2% washout trigger
// never fires and its one momentum trade loses. The baselines agree the window
// punishes activity: ema-cross -$106, rsi-bollinger -$24, adx-momentum -$33,
// while buy-and-hold makes only +$1.07. What this window does reward is small
// mean reversion: after a -1% fall over 60 bars, the next 120 bars average
// +0.66% (7/7 winning), and a +0.8% take-profit hits 6/7 times within 180
// bars. But the same signal FAILS on the previous (downtrending, -4%) window
// (+60 bars average -0.50%, 8/19 stopped out at -1.5%), so the small-dip leg
// only fires when the 6-hour trend is not down. Momentum-chasing is dropped
// entirely: after a +1% rise over 30 bars this window falls on average (-0.71%
 // over the next 30 bars, -1.04% over 60), so buying surges is buying tops.
//
// Strategy (one position at a time):
//   1. SMALL-DIP leg (mean reversion, trend-filtered): when the close first
//      falls 1% below the close 60 bars ago AND the 6-hour trend is not down
//      (close no more than 1% below the close 360 bars ago), buy with 50% of
//      cash, single tranche (no averaging down: small dips in a turn keep
//      falling). Exit: take profit at +1.2% over the average entry cost; a
//      trailing stop of 0.5% below the peak close, armed once the peak gain
//      reaches +0.6%; a stop-loss at -1.5%; and a 120-bar maximum hold.
//   2. BIG-DIP leg (tiered washout, unchanged from the previous instance):
//      when the close first falls 2% below the close 120 bars ago, buy with
//      40% of cash; while holding, if the close falls further to 2.6% below
//      the close 120 bars ago, buy with the remaining cash. Exit: take profit
//      at +4.5%; trailing stop 1% below the peak, armed at +3%; stop-loss
//      -2%; 180-bar maximum hold. This leg never fires on this dev window; it
//      is insurance for race windows that do wash out, where it is the proven
//      earner (+$46.49 on the previous window's hour-17 washout).
//   3. FALLBACK leg: if no order has ever filled by bar 1200, buy 25% of cash
//      and sell 60 bars later, so the entry still meets the 1-trade guardrail
//      on a window too calm for either signal leg.
//   4. COOLDOWN: 60 bars after every exit before a signal leg may enter again,
//      so the bot never re-buys into the same falling move.
//
// Local grade on THIS dev window (grade-local, driver process, two runs,
// byte-identical action logs, a3dbc424...): net PnL +7.592273 USDC, 6 trades,
// 3 round trips (2 wins, 1 small loss), win rate 0.667, max drawdown 0.3312%,
// 0 rejected, +6.382586 USDC at doubled fees. Per-trade (from the grader's
// per-hour blocks): bar 373 dip-buy +$2.14 (max-hold exit), bar 570 dip-buy
// +$6.09 (take-profit +1.2%), bar 1096 dip-buy -$0.65 (max-hold exit). The
// big-dip leg never fires on this window. Cross-check on the PREVIOUS
// instance's dev window (2026-11-15, -4% downtrend): +44.750441 USDC, 10
// trades, win rate 0.75, +42.322141 USDC at doubled fees — the small-dip leg
// costs $2.45 there (one filtered-in loser) and dropping momentum costs $2.20,
// against the washout leg's +$46.49.
// Honest caveat: the small-dip edge rests on 7 events in one calm window, so
// its size is uncertain; the trend filter and the single tranche are what keep
// it from becoming a falling-knife buyer on a downtrending race window. The
// big-dip leg is the robust earner, but only if the race window washes out.
// What the race window pays depends on which regime it is in.
//
// Determinism: every decision is a pure function of the closes and fills seen
// so far (float64 arithmetic, IEEE 754, no wall clock, no randomness, no
// environment). Position state is taken from the fills each batch reports, so
// a rejected order never desyncs the bot: an exit whose sell is rejected is
// simply sent again on the next bar while its time is up, and a rejected
// second-tranche buy is retried while the deep-dip condition still holds.
//
// Costs: each order caps slippage at 100 bps past the close it was decided on,
// so a fill into a liquidity gap is refused rather than filled for nothing.

import { runBars, type BarsState, type Batch, type BuyInput } from './vendor/makefun-bars.ts';

/** Small-dip leg: buy when the close first falls this far below the close SMALL_BARS ago. */
const SMALL_BARS = 60;
const SMALL_DROP = 0.01;
/** Small-dip leg: single tranche, this fraction of cash (1/2 = 50%). */
const SMALL_NUM = 1n;
const SMALL_DEN = 2n;
/** Small-dip leg: take profit at this gain over the average entry cost. */
const SMALL_TP = 0.012;
/** Small-dip leg: trailing stop, this far below the peak close since entry, armed at SMALL_TRAIL_ARM gain. */
const SMALL_TRAIL = 0.005;
const SMALL_TRAIL_ARM = 0.006;
/** Small-dip leg: stop-loss at this loss under the average entry cost. */
const SMALL_STOP = 0.015;
/** Small-dip leg: maximum bars to hold from the first fill. */
const SMALL_HOLD_BARS = 120;
/** Small-dip leg trend filter: only enter when the close is no more than this below the close TREND_BARS ago. */
const TREND_BARS = 360;
const TREND_MAX_DROP = 0.01;

/** Big-dip leg: buy tranche 1 when the close first falls this far below the close BIG_BARS ago. */
const BIG_BARS = 120;
const BIG_DROP = 0.02;
/** Tranche 1 size: this fraction of cash (2/5 = 40%). */
const TIER1_NUM = 2n;
const TIER1_DEN = 5n;
/** Tranche 2: while holding the big-dip leg, buy the rest of the cash when the close falls this far below the close BIG_BARS ago. */
const TIER2_DROP = 0.026;
/** Big-dip leg: take profit at this gain over the average entry cost. */
const BIG_TP = 0.045;
/** Big-dip leg: trailing stop, this far below the peak close since entry, armed at BIG_TRAIL_ARM gain. */
const BIG_TRAIL = 0.01;
const BIG_TRAIL_ARM = 0.03;
/** Big-dip leg: stop-loss at this loss under the average entry cost. */
const BIG_STOP = 0.02;
/** Big-dip leg: maximum bars to hold from the first fill. */
const BIG_HOLD_BARS = 180;

/** Bars to wait after an exit before a signal leg may enter again. */
const COOLDOWN_BARS = 60;

/** Fallback leg: if nothing ever filled by this bar, buy FALLBACK_FRACTION of cash. */
const FALLBACK_BAR = 1200;
const FALLBACK_FRACTION_NUM = 1n;
const FALLBACK_FRACTION_DEN = 4n;
/** Bars to hold a fallback-leg position. */
const FALLBACK_HOLD_BARS = 60;

/** Max slippage per order, in bps past the close it was decided on. */
const MAX_SLIPPAGE_BPS = 100;

type Mode = 'small' | 'big' | 'fallback';

/** Per-leg exit parameters. */
function legParams(mode: Mode): { tp: number; trail: number; arm: number; stop: number; hold: number } {
  if (mode === 'small') return { tp: SMALL_TP, trail: SMALL_TRAIL, arm: SMALL_TRAIL_ARM, stop: SMALL_STOP, hold: SMALL_HOLD_BARS };
  if (mode === 'big') return { tp: BIG_TP, trail: BIG_TRAIL, arm: BIG_TRAIL_ARM, stop: BIG_STOP, hold: BIG_HOLD_BARS };
  return { tp: Infinity, trail: Infinity, arm: Infinity, stop: BIG_STOP, hold: FALLBACK_HOLD_BARS };
}

/** Closes by batch seq (a missing bar repeats the last close, so indices stay aligned). */
const closes: number[] = [];
let lastClose: number | null = null;

/** Filled trades so far (buys + sells). */
let fills = 0;
/** Seq the current position's first buy filled on, and which leg opened it. */
let entrySeq = -1;
let mode: Mode | null = null;
/** The leg of the buy order most recently sent (confirmed on its fill). */
let pendingMode: Mode | null = null;
/** Seq the last exit's sell filled on (-1e9 = never). */
let lastExitSeq = -1_000_000_000;
/** Big-dip leg: whether the second tranche has been sent / filled. */
let tier2Sent = false;
let tier2Done = false;
/** Highest close since the current position's entry (0 = none yet). */
let peakClose = 0;

/** The close `bars` back from seq, or null when not enough history exists yet. */
function closeBack(seq: number, bars: number): number | null {
  const i = seq - bars;
  return i < 0 || closes[i] === undefined ? null : closes[i]!;
}

/** True when the close at this seq is at least `drop` below the close `bars` ago. */
function dipHolds(seq: number, bars: number, drop: number): boolean {
  const now = closes[seq];
  const then = closeBack(seq, bars);
  return now !== undefined && then !== null && now < then * (1 - drop);
}

/** True when the 6-hour trend is not down (close no more than TREND_MAX_DROP below the close TREND_BARS ago). */
function trendOk(seq: number): boolean {
  const now = closes[seq];
  const then = closeBack(seq, TREND_BARS);
  return now !== undefined && then !== null && now >= then * (1 - TREND_MAX_DROP);
}

/**
 * The position's average entry price in raw price units (the same scale as a
 * bar's close), from its fill-based cost: avgPx = cost * 10^(qty+price-quote
 * scales) / qty. Null when there is no position.
 */
function avgEntryPrice(state: BarsState, symbol: string): number | null {
  const held = state.positions.get(symbol);
  if (held === undefined || held.qty === 0n) return null;
  const s = state.hello.symbols[0]!;
  const exp = s.qty_scale + s.price_scale - state.hello.capital.quote_scale;
  return (Number(held.cost) * 10 ** exp) / Number(held.qty);
}

function buyAmount(state: BarsState, symbol: string, spend: bigint, leg: Mode): BuyInput | null {
  const minNotional = BigInt(state.hello.fees.min_notional_quote_units);
  const room = state.weightRoom(symbol);
  if (room < spend) spend = room;
  if (spend < minNotional) return null;
  pendingMode = leg;
  return { side: 'buy', symbol, notional_quote_units: spend, max_slippage_bps: MAX_SLIPPAGE_BPS };
}

await runBars({
  onBatch(state, batch: Batch) {
    const symbol = state.hello.symbols[0]!.symbol;
    const seq = state.seq;

    // Fold this batch's fills into position state before deciding.
    for (const f of batch.fills) {
      if (f.symbol !== symbol) continue;
      if (f.side === 'buy') {
        if (f.status === 'filled') {
          fills++;
          if (mode === null) {
            // First buy of a new position.
            entrySeq = seq;
            mode = pendingMode ?? 'big';
          } else if (mode === 'big') {
            // A second buy while holding the big-dip leg is the second tranche.
            tier2Done = true;
          }
          pendingMode = null;
        } else if (mode === 'big') {
          // A rejected buy while holding the big-dip leg is the second tranche:
          // allow a retry while the deep-dip condition still holds.
          tier2Sent = false;
          pendingMode = null;
        } else {
          pendingMode = null;
        }
      } else if (f.status === 'filled') {
        fills++;
        lastExitSeq = seq;
        mode = null;
        entrySeq = -1;
        tier2Sent = false;
        tier2Done = false;
        peakClose = 0;
      }
    }

    // Record this batch's close (repeat the last one when this minute has no
    // bar, so indices stay aligned with seq; nothing is recorded before the
    // first bar, and the guards below refuse to trade on no history).
    for (const bar of batch.bars) {
      if (bar.symbol === symbol) lastClose = Number(bar.c);
    }
    if (lastClose !== null) closes[seq] = lastClose;
    if (closes[seq] === undefined) return [];

    const held = state.positions.get(symbol);

    // Holding: manage the position. A rejected sell is retried on the next bar
    // because the exit condition still holds.
    if (held !== undefined) {
      const leg = mode ?? 'big';
      const now = closes[seq]!;
      if (now > peakClose) peakClose = now;
      const p = legParams(leg);

      // Big-dip leg, second tranche: the dip deepened, buy the rest of the cash.
      // Sent alone this bar: an exit cannot trigger on a tranche bar (the
      // price just fell), and the buy's fill lands on the next bar.
      if (leg === 'big' && !tier2Sent && !tier2Done && dipHolds(seq, BIG_BARS, TIER2_DROP)) {
        const order = buyAmount(state, symbol, state.cash, 'big');
        if (order !== null) {
          tier2Sent = true;
          return [order];
        }
      }

      const avgPx = avgEntryPrice(state, symbol);
      if (avgPx !== null && avgPx > 0) {
        const gain = now / avgPx - 1;
        // Take profit: the snap-back paid.
        if (gain >= p.tp) {
          return [{ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
        // Trailing stop: the recovery stalled below the take-profit after
        // running up, so lock in most of it.
        if (peakClose / avgPx - 1 >= p.arm && now < peakClose * (1 - p.trail)) {
          return [{ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
        // Stop-loss (every leg): the position is falling, cut it.
        if (gain <= -p.stop) {
          return [{ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        }
      }

      // Maximum hold.
      if (seq - entrySeq >= p.hold) {
        return [{ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Flat: a stale mode (e.g. a buy rejected after its leg was set) clears here.
    mode = null;
    tier2Sent = false;
    tier2Done = false;
    peakClose = 0;
    if (state.warmingUp) return [];
    if (seq - lastExitSeq < COOLDOWN_BARS) return [];

    // Signal legs, edge-triggered: the condition must hold now and not on the
    // previous bar, so each dip is bought exactly once. The big-dip edge is
    // checked first: a genuine washout takes precedence over a small dip.
    const bigEdge = dipHolds(seq, BIG_BARS, BIG_DROP) && !dipHolds(seq - 1, BIG_BARS, BIG_DROP);
    if (bigEdge) {
      const spend = (state.cash * TIER1_NUM) / TIER1_DEN;
      const order = buyAmount(state, symbol, spend, 'big');
      return order === null ? [] : [order];
    }
    const smallEdge = dipHolds(seq, SMALL_BARS, SMALL_DROP) && !dipHolds(seq - 1, SMALL_BARS, SMALL_DROP);
    if (smallEdge && trendOk(seq)) {
      const spend = (state.cash * SMALL_NUM) / SMALL_DEN;
      const order = buyAmount(state, symbol, spend, 'small');
      return order === null ? [] : [order];
    }

    // Fallback: guarantee at least one trade on a window too calm for signals.
    if (fills === 0 && seq >= FALLBACK_BAR) {
      const spend = (state.cash * FALLBACK_FRACTION_NUM) / FALLBACK_FRACTION_DEN;
      const order = buyAmount(state, symbol, spend, 'fallback');
      return order === null ? [] : [order];
    }
    return [];
  },
});
