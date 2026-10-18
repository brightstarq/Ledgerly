// Ledgerly agent: plans -> tiered, audited tool execution -> plain-language report.
// The planner may be rule-based (offline) or an LLM; either way the plan is VALIDATED against the tool
// registry, dependencies and permission tiers, so a model can never exceed what the policy allows.
import * as analysis from './analysis.js';
import * as financing from './financing.js';
import * as fc from './forecast.js';
import * as passport from './passport.js';
import { SandboxEnv } from './sandbox.js';
import { AuditLog, PermissionDenied, Policy, Tier, tierName } from './security.js';
import { iso, naira, pct, round } from './util.js';

export const TOOLS = {
  forecast: [Tier.READ, []],
  passport: [Tier.READ, []],
  alerts: [Tier.READ, ['forecast', 'passport']],
  match: [Tier.READ, ['forecast', 'passport']],
  pack: [Tier.PREPARE, ['match']],
  notify: [Tier.ACT_LOW, ['alerts']],
  submit: [Tier.ACT_MONEY, ['pack']],
};

export const TOOL_INFO = {
  forecast: 'Forecast cash for the next 13 weeks',
  passport: 'Score cash-flow credit passport',
  alerts: 'Check for cash risks',
  match: 'Compare financing options',
  pack: 'Prepare lender pack',
  notify: 'Send owner alert (sandbox SMS)',
  submit: 'Apply and receive funds (sandbox)',
};

export function route(goal) {
  const g = goal.toLowerCase();
  const steps = ['forecast', 'passport', 'alerts'];
  if (['loan', 'financ', 'borrow', 'fund', 'capital', 'stock', 'restock', 'afford'].some((k) => g.includes(k))) steps.push('match', 'pack');
  if (['apply', 'submit', 'take the', 'get the'].some((k) => g.includes(k))) steps.push('notify', 'submit');
  if (g.includes('alert') || g.includes('notify')) steps.push('notify');
  return steps;
}

export function resolve(steps) {
  const out = [];
  const visit = (s) => {
    if (!(s in TOOLS)) return; // unknown tool from a planner is dropped
    for (const d of TOOLS[s][1]) visit(d);
    if (!out.includes(s)) out.push(s);
  };
  for (const s of steps) visit(s);
  return out;
}

const roundFloats = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' && !Number.isInteger(v) ? Math.round(v) : v]));

export class Agent {
  constructor(business, txns, openingBalance, consent, { policy, env, audit, llmPlanner, approver } = {}) {
    this.b = business;
    this.txns = txns;
    this.opening = openingBalance;
    this.consent = consent;
    this.policy = policy ?? new Policy();
    this.env = env ?? new SandboxEnv(openingBalance);
    this.audit = audit ?? new AuditLog();
    this.llmPlanner = llmPlanner ?? null;
    this.approver = approver ?? null;
    this.ctx = {};
  }

  // ---- planning
  async plan(goal) {
    let steps = route(goal);
    if (this.llmPlanner) {
      try {
        steps = (await this.llmPlanner(goal, Object.keys(TOOLS))) || steps;
      } catch (e) { // model failure never blocks the safe default
        this.audit.record('agent', 'planner_error', { error: String(e?.message ?? e) });
      }
    }
    return resolve(steps);
  }

  // ---- tools
  _t_forecast() {
    const series = analysis.weeklySeries(this.txns);
    this.ctx.series = series;
    this.ctx.scen = fc.scenarios(series, this.opening);
  }

  _t_passport() {
    if (!this.consent.allows('credit_assessment')) throw new PermissionDenied('owner has not consented to credit_assessment');
    this.ctx.passport = passport.buildPassport(this.txns);
  }

  _t_alerts() {
    const { scen: s, passport: p } = this.ctx;
    const a = [];
    const d = s.downside.summary, base = s.base.summary;
    if (base.first_negative_week) a.push({ severity: 'high', msg: `Cash goes negative in the week of ${base.first_negative_week} even in the base case.` });
    if (d.need > 0) {
      a.push({
        severity: d.first_negative_week ? 'high' : 'medium',
        msg: `If sales are 20% weaker, cash could fall to ${naira(d.min_balance)} in the week of ${d.min_week}, below your two-week buffer of ${naira(d.safety_buffer)}.`,
      });
    }
    const m = p.metrics;
    if (m.top_customer_share > 0.3) a.push({ severity: 'medium', msg: `One customer is ${pct(m.top_customer_share)} of named sales.` });
    if (m.cash_share > 0.4) a.push({ severity: 'low', msg: `${pct(m.cash_share)} of sales are cash entries; digital records strengthen your passport.` });
    this.ctx.alerts = a;
  }

  _t_match() {
    const p = this.ctx.passport, d = this.ctx.scen.downside.summary;
    const need = this.ctx.requested_amount || d.need;
    this.ctx.match = financing.match(need, p.score, p.metrics.avg_monthly_revenue, p.weekly_repayment_capacity, this.ctx.has_collateral);
  }

  _t_pack() {
    if (!this.consent.allows('share_with_lender')) throw new PermissionDenied('owner has not consented to share_with_lender');
    const p = this.ctx.passport, m = this.ctx.match;
    this.ctx.pack = {
      business: { name: this.b.name, sector: this.b.sector, city: this.b.city },
      passport: { score: p.score, grade: p.grade, factors: p.factors.map(({ label, points, explanation }) => ({ label, points, explanation })) },
      forecast: roundFloats(this.ctx.scen.downside.summary),
      request: m.offers[0] ?? null,
      excluded_from_pack: ['raw transactions', 'customer identities', 'phone and account numbers'],
    };
  }

  _t_notify() {
    const hi = this.ctx.alerts.filter((a) => a.severity === 'high' || a.severity === 'medium').map((a) => a.msg);
    this.ctx.notify = this.env.notifyOwner(hi.join(' | ') || 'No cash risks detected.', `notify-${this.b.name}`);
  }

  _t_submit() {
    const offer = this.ctx.pack.request;
    if (!offer) {
      this.ctx.submit = { status: 'SKIPPED', reason: 'no eligible offer' };
      return;
    }
    const prod = financing.CATALOGUE.find((x) => x.id === offer.product_id);
    const a = this.env.apply(prod.id, offer.amount, this.ctx.passport.score, prod.min_score, `apply-${this.b.name}-${prod.id}-${offer.amount}`);
    const res = { application: a };
    if (a.status === 'APPROVED') res.disbursement = this.env.disburse(a.ref, `disb-${a.ref}`);
    this.ctx.submit = res;
  }

  // ---- execution
  async run(goal, { requestedAmount = null, hasCollateral = false } = {}) {
    this.ctx = { requested_amount: requestedAmount, has_collateral: hasCollateral };
    const steps = await this.plan(goal);
    this.audit.record('owner', 'goal', { goal, plan: steps });
    let status = 'complete', pending = null;
    const stepLog = [];
    for (const name of steps) {
      const tier = TOOLS[name][0];
      try {
        this.policy.check(name, tier);
        if (this.policy.needsApproval(tier) && this.ctx.pack?.request) {
          const preview = { tool: name, offer: this.ctx.pack.request };
          this.audit.record('agent', 'approval_requested', preview);
          if (!(this.approver && (await this.approver(name, preview)))) {
            this.audit.record('agent', 'paused_pending_approval', { tool: name });
            status = 'pending_approval'; pending = name;
            stepLog.push({ tool: name, status: 'waiting' });
            break;
          }
          this.audit.record('owner', 'approved', { tool: name });
        }
        this['_t_' + name]();
        this.audit.record('agent', 'tool_ok', { tool: name, tier });
        stepLog.push({ tool: name, status: 'done' });
      } catch (e) {
        if (!(e instanceof PermissionDenied)) throw e;
        this.audit.record('agent', 'denied', { tool: name, reason: e.message });
        status = 'denied'; pending = name;
        stepLog.push({ tool: name, status: 'blocked', reason: e.message });
        break;
      }
    }
    for (const name of steps) if (!stepLog.some((s) => s.tool === name)) stepLog.push({ tool: name, status: 'not_run' });
    return this._report(goal, steps, status, pending, stepLog);
  }

  _report(goal, steps, status, pending, stepLog) {
    const c = this.ctx;
    const rep = {
      goal, plan: steps, status, pending,
      passport: c.passport ?? null, alerts: c.alerts ?? [], match: c.match ?? null,
      pack: c.pack ?? null, submit: c.submit ?? null, audit_chain_valid: this.audit.verify(),
    };
    if (c.scen) rep.forecast = Object.fromEntries(Object.entries(c.scen).map(([k, v]) => [k, v.summary]));
    rep.summary = this._narrate(rep);
    // Extra detail for the dashboard (not part of the lender pack).
    rep.steps = stepLog.map((s) => ({ ...s, tier: tierName(TOOLS[s.tool][0]), label: TOOL_INFO[s.tool] }));
    if (c.scen) {
      rep.forecast_weeks = Object.fromEntries(Object.entries(c.scen).map(([k, v]) => [k,
        v.weeks.map((w) => ({ week_start: iso(w.week_start), inflow: round(w.inflow), outflow: round(w.outflow), closing: round(w.closing) }))]));
      rep.history_weeks = c.series.slice(-13).map(([d, i, o]) => ({ week_start: iso(d), inflow: round(i), outflow: round(o) }));
    }
    return rep;
  }

  _narrate(r) {
    const L = [];
    const p = r.passport;
    if (p) L.push(`Your cash-flow credit passport: ${p.score}/100 (grade ${p.grade}). Biggest levers: ` + p.improve.join(' '));
    for (const a of r.alerts) L.push(`[${a.severity.toUpperCase()}] ${a.msg}`);
    const m = r.match;
    if (m) {
      if (!m.offers.length) L.push(m.note || 'No eligible offers.');
      else {
        const o = m.offers[0];
        L.push(`Best fit for a ${naira(m.need)} gap: ${o.name} ${naira(o.amount)} over ${o.term_weeks} weeks, `
          + `total cost ${naira(o.total_cost)} (effective APR ${pct(o.effective_apr)}), about ${naira(o.weekly_payment)}/week. ${o.why}.`);
      }
    }
    if (r.status === 'pending_approval') L.push('Waiting for your approval before I submit anything. I will not move money without it.');
    else if (r.submit) L.push(`Sandbox result: ${JSON.stringify(r.submit)}`);
    return L.join('\n');
  }
}

export { Policy, Tier };
