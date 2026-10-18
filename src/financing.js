// Financing-option matching. The catalogue is ILLUSTRATIVE (synthetic terms) for the demo;
// production would pull live lender terms through partner APIs.
import { round } from './util.js';

const product = (id, name, min_score, apr, fee_pct, term_weeks, max_multiple, max_abs = null, collateral = false, days_to_fund = 3) =>
  Object.freeze({ id, name, min_score, apr, fee_pct, term_weeks, max_multiple, max_abs, collateral, days_to_fund });

export const CATALOGUE = [
  product('BANK-WC', 'Bank working-capital loan', 70, 0.28, 0.01, 16, 1.0, null, true, 10),
  product('FIN-CF', 'Fintech cash-flow loan', 55, 0.36, 0.02, 12, 0.6, null, false, 2),
  product('MFB-GRP', 'Microfinance group loan', 40, 0.3, 0.02, 24, 0.5, null, false, 7),
  product('SUP-NET30', 'Supplier credit (2/10 net 30)', 45, 0.0, 0.02, 2.9, 0.5, null, false, 0),
  product('MM-OD', 'Mobile-money overdraft', 35, 0.6, 0.03, 4, 0.1, 150_000, false, 0),
];

export function evaluate(p, amount, capacityWeekly) {
  const interest = (amount * p.apr * p.term_weeks) / 52;
  const fees = amount * p.fee_pct;
  const cost = interest + fees;
  const weekly = (amount + cost) / p.term_weeks;
  return {
    product_id: p.id, name: p.name, amount: Math.round(amount), term_weeks: p.term_weeks,
    total_cost: Math.round(cost), effective_apr: round(((cost / amount) * 52) / p.term_weeks, 3),
    weekly_payment: Math.round(weekly), affordable: weekly <= capacityWeekly,
    days_to_fund: p.days_to_fund, collateral_required: p.collateral,
  };
}

export function match(need, score, avgMonthlyRevenue, capacityWeekly, hasCollateral = false) {
  if (need <= 0) return { need: 0, offers: [], note: 'No financing needed: cash stays above the safety buffer.' };
  need = Math.ceil(need / 10_000) * 10_000;
  const offers = [];
  for (const p of CATALOGUE) {
    if (score < p.min_score || (p.collateral && !hasCollateral)) continue;
    let cap = p.max_multiple * avgMonthlyRevenue;
    if (p.max_abs) cap = Math.min(cap, p.max_abs);
    const amount = Math.min(need, cap);
    if (amount <= 0) continue;
    const o = evaluate(p, amount, capacityWeekly);
    o.covers_need = amount >= need;
    offers.push(o);
  }
  const tierOf = (o) => (o.affordable && o.covers_need ? 0 : o.affordable ? 1 : 2);
  offers.sort((a, b) => tierOf(a) - tierOf(b) || a.effective_apr - b.effective_apr);
  for (const o of offers) {
    o.why = o.affordable && o.covers_need ? 'Covers the gap and fits your repayment capacity'
      : o.affordable ? 'Affordable but only covers part of the gap'
        : 'Weekly payment exceeds your repayment capacity';
  }
  return { need, offers, note: offers.length ? '' : 'No eligible product at this score.' };
}
