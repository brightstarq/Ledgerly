// 13-week cash forecast (seasonal-naive), base/downside/upside.
import { addDays, iso, mean, month } from './util.js';

export function monthFactors(series, idx) {
  const overall = mean(series.map((s) => s[idx]));
  const byM = new Map();
  for (const s of series) {
    const m = month(s[0]);
    if (!byM.has(m)) byM.set(m, []);
    byM.get(m).push(s[idx]);
  }
  // shrink 30% toward 1.0: one year of history is thin evidence of seasonality
  const out = new Map();
  for (const [m, v] of byM) out.set(m, overall ? 0.7 * (mean(v) / overall) + 0.3 : 1.0);
  return out;
}

/** Same weeks one year earlier (3-week centred average), scaled by recent trend if 60+ weeks exist. */
function seasonalNaive(series, weeks) {
  const n = series.length;
  const ref = n - 52;
  let trend = 1.0;
  if (n >= 60) {
    const a = series.slice(-8).reduce((s, x) => s + x[1], 0);
    const b = series.slice(-60, -52).reduce((s, x) => s + x[1], 0);
    trend = b ? Math.min(1.25, Math.max(0.8, a / b)) : 1.0;
  }
  const at = (j, idx) => {
    const lo = Math.max(0, j - 1), hi = Math.min(n - 1, j + 1);
    const vals = [];
    for (let k = lo; k <= hi; k++) vals.push(series[k][idx]);
    return mean(vals);
  };
  return Array.from({ length: weeks }, (_, k) => [at(ref + k, 1) * trend, at(ref + k, 2) * trend]);
}

/** 52+ weeks of history: seasonal-naive (same weeks last year). Less: deseasonalised level x month factor.
 *  Transparent by design, so a lender or owner can audit every number. */
export function forecast(series, openingBalance, weeks = 13, inflowMult = 1.0, outflowMult = 1.0) {
  const start = addDays(series.at(-1)[0], 7);
  let bal = openingBalance;
  let pairs;
  if (series.length >= 52) {
    pairs = seasonalNaive(series, weeks);
  } else {
    const fi = monthFactors(series, 1), fo = monthFactors(series, 2);
    const tail = series.slice(-8);
    const li = mean(tail.map((s) => s[1] / (fi.get(month(s[0])) ?? 1.0)));
    const lo = mean(tail.map((s) => s[2] / (fo.get(month(s[0])) ?? 1.0)));
    pairs = Array.from({ length: weeks }, (_, k) => {
      const m = month(addDays(start, 7 * k));
      return [li * (fi.get(m) ?? 1.0), lo * (fo.get(m) ?? 1.0)];
    });
  }
  return pairs.map(([i, o], k) => {
    i *= inflowMult; o *= outflowMult;
    bal += i - o;
    return { week_start: addDays(start, 7 * k), inflow: i, outflow: o, closing: bal };
  });
}

export function summarize(fc, openingBalance) {
  const low = fc.reduce((a, w) => (w.closing < a.closing ? w : a));
  const buffer = 2 * mean(fc.map((w) => w.outflow)); // safety buffer: two weeks of outflows
  const neg = fc.find((w) => w.closing < 0);
  return {
    min_balance: low.closing, min_week: iso(low.week_start),
    first_negative_week: neg ? iso(neg.week_start) : null,
    safety_buffer: buffer,
    need: Math.max(0, buffer - low.closing),
    end_balance: fc.at(-1).closing, opening_balance: openingBalance,
  };
}

export const SCENARIOS = { base: [1.0, 1.0], downside: [0.8, 1.0], upside: [1.1, 1.0] };

export function scenarios(series, openingBalance, weeks = 13) {
  const res = {};
  for (const [name, [im, om]] of Object.entries(SCENARIOS)) {
    const fc = forecast(series, openingBalance, weeks, im, om);
    res[name] = { weeks: fc, summary: summarize(fc, openingBalance) };
  }
  return res;
}
