// Cash-flow credit passport. Inputs are TRANSACTION BEHAVIOUR ONLY.
// No gender, ethnicity, religion, age or location enters the score.
import * as analysis from './analysis.js';
import { clamp, pct, round, sum } from './util.js';

export const TIPS = {
  history: 'Keep every sale and expense recorded for 12 months; longer history raises trust.',
  stability: 'Smooth revenue with repeat customers, pre-orders or subscriptions.',
  margin: 'Review supplier prices and low-margin lines to widen your operating margin.',
  growth: 'Grow monthly sales; even steady 5% growth lifts this factor.',
  concentration: 'Avoid depending on one or two customers for most of your sales.',
  coverage: 'Keep operating cash well above loan repayments before taking new debt.',
  discipline: 'Repay on time every month and keep the repayment records in the app.',
};

export const grade = (s) => (s >= 75 ? 'A' : s >= 60 ? 'B' : s >= 45 ? 'C' : 'D');

export function buildPassport(txns) {
  const mt = analysis.metrics(txns);
  const ms = mt.monthly;
  const rev = ms.map((m) => m.revenue);
  const f = [];
  const add = (key, label, weight, s, why) => {
    s = clamp(s);
    f.push({ key, label, weight, score01: round(s, 3), points: round(weight * s, 1), explanation: why });
  };

  add('history', 'Records history', 10, mt.months / 12, `${mt.months} complete months of records.`);
  add('stability', 'Revenue stability', 20, 1 - mt.revenue_cv / 0.6,
    `Monthly revenue varies by ${pct(mt.revenue_cv)} (lower is steadier).`);
  add('margin', 'Operating margin', 20, mt.op_margin / 0.2,
    `Operating margin is ${pct(mt.op_margin)} before loan repayments and owner draws.`);
  const g = rev.length >= 6 ? sum(rev.slice(-3)) / Math.max(1, sum(rev.slice(-6, -3))) - 1 : 0;
  add('growth', 'Sales trend', 10, 0.5 + g * 2.5, `Last 3 months vs previous 3: ${pct(g, true)}.`);
  const t = mt.top_customer_share;
  add('concentration', 'Customer spread', 10, 1 - (t - 0.1) / 0.3, `Largest named customer is ${pct(t)} of named sales.`);
  const loan = sum(ms.map((m) => m.loan));
  if (loan > 0) {
    const dscr = sum(ms.map((m) => m.op_cash)) / loan;
    add('coverage', 'Debt-service coverage', 20, (dscr - 1) / 2, `Operating cash covers repayments ${dscr.toFixed(1)}x.`);
  } else {
    add('coverage', 'Debt-service coverage', 20, 0.7, 'No recorded debt service (neutral).');
  }
  const paid = ms.filter((m) => m.loan > 0);
  if (paid.length) {
    const first = ms.findIndex((m) => m.loan > 0);
    const spanM = ms.length - first;
    add('discipline', 'Repayment discipline', 10, paid.length / spanM,
      `Repayments recorded in ${paid.length} of ${spanM} months since the first one.`);
  } else {
    add('discipline', 'Repayment discipline', 10, 0.5, 'No repayment history (neutral).');
  }

  const score = round(sum(f.map((x) => x.points)), 1);
  const weakest = [...f].sort((a, b) => b.weight * (1 - b.score01) - a.weight * (1 - a.score01)).slice(0, 2);
  const { monthly: _omit, ...rest } = mt;
  return {
    score, grade: grade(score), factors: f,
    improve: weakest.map((w) => TIPS[w.key]),
    weekly_repayment_capacity: mt.weekly_repayment_capacity, metrics: rest,
  };
}
