// Monthly and weekly metrics.
import { addDays, dateOf, daysBetween, daysInMonth, iso, mean, month, pstdev, sum, weekday, year } from './util.js';

export const WEEKS_PER_MONTH = 4.345;

const span = (txns) => [txns.reduce((a, t) => (t.day < a ? t.day : a), txns[0].day),
  txns.reduce((a, t) => (t.day > a ? t.day : a), txns[0].day)];

/** Complete months only (>=80% of days covered by the data span). */
export function monthly(txns) {
  const [first, last] = span(txns);
  const agg = new Map();
  for (const t of txns) {
    const key = `${year(t.day)}-${String(month(t.day)).padStart(2, '0')}`;
    if (!agg.has(key)) agg.set(key, { y: year(t.day), m: month(t.day), revenue: 0, loan: 0, draw: 0, op_out: 0 });
    const a = agg.get(key);
    if (t.amount > 0) a.revenue += t.amount;
    else if (t.category === 'loan_repayment') a.loan += -t.amount;
    else if (t.category === 'owner_draw') a.draw += -t.amount;
    else a.op_out += -t.amount;
  }
  const out = [];
  for (const key of [...agg.keys()].sort()) {
    const a = agg.get(key);
    const dim = daysInMonth(a.y, a.m);
    const lo = new Date(Math.max(first, dateOf(a.y, a.m, 1)));
    const hi = new Date(Math.min(last, dateOf(a.y, a.m, dim)));
    if (daysBetween(lo, hi) + 1 < 0.8 * dim) continue;
    out.push({
      month: key, revenue: a.revenue, op_out: a.op_out, loan: a.loan, draw: a.draw,
      op_cash: a.revenue - a.op_out, net: a.revenue - a.op_out - a.loan - a.draw,
    });
  }
  return out;
}

export function metrics(txns) {
  const ms = monthly(txns);
  const rev = ms.map((m) => m.revenue);
  const totRev = sum(rev);
  const opCash = sum(ms.map((m) => m.op_cash));
  const named = new Map();
  for (const t of txns) {
    if (t.amount > 0 && t.counterparty && t.counterparty !== 'walk-in') named.set(t.counterparty, (named.get(t.counterparty) ?? 0) + t.amount);
  }
  const namedTotal = sum([...named.values()]);
  const avgRev = rev.length ? mean(rev) : 0;
  return {
    months: ms.length,
    avg_monthly_revenue: avgRev,
    revenue_cv: rev.length && avgRev ? pstdev(rev) / avgRev : 0,
    op_margin: totRev ? opCash / totRev : 0,
    avg_monthly_op_cash: ms.length ? opCash / ms.length : 0,
    weekly_repayment_capacity: ms.length ? (0.5 * (opCash / ms.length)) / WEEKS_PER_MONTH : 0,
    top_customer_share: namedTotal ? Math.max(...named.values()) / namedTotal : 0,
    cash_share: totRev ? sum(txns.filter((t) => t.amount > 0 && t.channel === 'cash').map((t) => t.amount)) / totRev : 0,
    monthly: ms,
  };
}

/** [weekStart, inflow, outflow]. Drops a partial first week and a last week that stops before Saturday. */
export function weeklySeries(txns) {
  const b = new Map();
  for (const t of txns) {
    const ws = iso(addDays(t.day, -weekday(t.day)));
    if (!b.has(ws)) b.set(ws, [0, 0]);
    b.get(ws)[t.amount > 0 ? 0 : 1] += Math.abs(t.amount);
  }
  let rows = [...b.keys()].sort().map((k) => [new Date(k + 'T00:00:00Z'), b.get(k)[0], b.get(k)[1]]);
  const [first, last] = span(txns);
  if (weekday(first) > 0) rows = rows.slice(1);
  if (weekday(last) < 5) rows = rows.slice(0, -1);
  return rows;
}
