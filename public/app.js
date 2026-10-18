// Ledgerly dashboard. Plain JS, no build step.
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const commas = (n) => Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const naira = (x) => `${x < 0 && Math.round(x) !== 0 ? '−' : ''}₦${commas(x)}`;
const nairaShort = (x) => {
  const a = Math.abs(x), s = x < 0 ? '−' : '';
  if (a >= 1e6) return `${s}₦${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '')}m`;
  if (a >= 1e3) return `${s}₦${Math.round(a / 1e3)}k`;
  return `${s}₦${Math.round(a)}`;
};
const pct = (x) => `${Math.round(x * 100)}%`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const d8 = (s) => { const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };
const shortDate = (s) => { const { m, d } = d8(s); return `${d} ${MONTHS[m - 1]}`; };
const longDate = (s) => { const { y, m, d } = d8(s); return `${d} ${MONTHS[m - 1]} ${y}`; };
const addWeeks = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 7 * 864e5).toISOString().slice(0, 10);
const svgNS = 'http://www.w3.org/2000/svg';

const SERIES = [
  { key: 'base', name: 'Expected', css: 'var(--s-base)' },
  { key: 'downside', name: 'Sales 20% weaker', css: 'var(--s-down)' },
  { key: 'upside', name: 'Sales 10% stronger', css: 'var(--s-up)' },
];
const TIER_TEXT = {
  READ: 'Reads your records',
  PREPARE: 'Prepares a document, sends nothing',
  ACT_LOW: 'Sends you a message',
  ACT_MONEY: 'Moves money, so it needs your approval',
};
const EXAMPLES = [
  'Do I need a loan for the December rush?',
  'How does my cash look for the next 3 months?',
  'Apply for the best financing option',
];
const ICON = {
  high: '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M10 1.5 19 17.5H1L10 1.5Zm-.9 6v5h1.8v-5H9.1Zm0 6.5v1.8h1.8V14H9.1Z"/></svg>',
  medium: '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M10 1a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm-.9 4.5v6h1.8v-6H9.1Zm0 7.5v1.8h1.8V13H9.1Z"/></svg>',
  low: '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M10 1a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm-.9 7.5v6h1.8v-6H9.1Zm0-3.3v1.8h1.8V5.2H9.1Z"/></svg>',
  ok: '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M10 1a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm4 5.6-5.1 5.1L6 8.9l-1.3 1.3 4.2 4.2 6.4-6.4L14 6.6Z"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
};
const SEV = { high: 'Act now', medium: 'Worth planning for', low: 'Good to know' };

let S = null;
let busy = false;

// ---------------------------------------------------------------- API
async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let data;
  try { data = await res.json(); } catch { throw new Error('The Ledgerly server did not answer. Check that it is still running in your terminal.'); }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

async function act(path, body, { success, button } = {}) {
  if (busy) return;
  busy = true;
  const label = button?.textContent;
  document.body.setAttribute('aria-busy', 'true');
  $('#answer-wrap').classList.add('is-loading');
  document.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  if (button) button.textContent = 'Working…';
  try {
    S = await api(path, body);
    render(true);
    if (success) toast(typeof success === 'function' ? success(S) : success);
  } catch (e) {
    toast(e.message, true);
  } finally {
    busy = false;
    document.body.removeAttribute('aria-busy');
    $('#answer-wrap').classList.remove('is-loading');
    document.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    if (button && button.isConnected) button.textContent = label;
  }
}

let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('is-error', error);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, error ? 7000 : 4500);
}

// ---------------------------------------------------------------- render
function render(reveal = false) {
  const r = S.report;
  renderTop();
  renderAnswer(r, reveal);
  renderForecast(r);
  renderPassport(r);
  renderAlerts(r);
  renderMonthly();
  renderFinancing(r);
  renderSteps(r);
  renderAudit();
}

function renderTop() {
  const { business: b, quality: q, period, source } = S;
  const flagged = q?.injection_flags ? `, ${q.injection_flags} suspicious memo${q.injection_flags > 1 ? 's' : ''} set aside` : '';
  const rejected = q?.rows_rejected ? `, ${q.rows_rejected} unreadable row${q.rows_rejected > 1 ? 's' : ''} skipped` : '';
  $('#biz').innerHTML = `<strong>${esc(b.name)}</strong>, ${esc(b.sector)} in ${esc(b.city)}. `
    + (period ? `${source.kind === 'sample' ? 'Sample records' : esc(source.name)} from ${longDate(period.from)} to ${longDate(period.to)} (${commas(q.rows_loaded)} entries${rejected}${flagged}).` : '');
}

function headline(r) {
  const f = r.forecast;
  if (!f) return { head: 'Ledgerly could not read your cash position.', sub: 'Check your records in Settings and ask again.' };
  const base = f.base, down = f.downside;
  const months = r.passport?.metrics?.months;
  const sub = [];
  const sub0 = `Based on ${months ? `${months} months of` : 'your'} sales and expenses. A normal quarter bottoms out at ${naira(base.min_balance)} in the week of ${shortDate(base.min_week)}.`;
  if (r.submit?.disbursement?.status === 'DISBURSED') {
    const o = r.pack.request;
    return {
      head: `${naira(o.amount)} is in your account. The cash gap around ${shortDate(down.min_week)} is covered.`,
      sub: `The ${o.name.toLowerCase()} was approved and paid into your sandbox account (reference ${r.submit.application.ref}). You repay about ${naira(o.weekly_payment)} a week for ${o.term_weeks} weeks.`,
    };
  }
  if (base.first_negative_week) {
    return { head: `Your cash could run out in the week of ${shortDate(base.first_negative_week)}.`, sub: `${sub0} That is below zero even if sales go as expected.` };
  }
  if (down.need > 0) {
    const gap = r.match?.need || Math.ceil(down.need / 10000) * 10000;
    sub.push(sub0, `If sales come in 20% weaker, cash drops to ${naira(down.min_balance)}, below the ${naira(down.safety_buffer)} you need to cover two weeks of costs.`);
    return { head: `If sales slow down, you could be ${naira(gap)} short by ${shortDate(down.min_week)}.`, sub: sub.join(' ') };
  }
  return { head: 'Your cash stays above your safety buffer for the next 13 weeks.', sub: `${sub0} Even with sales 20% weaker it stays above two weeks of costs.` };
}

function renderAnswer(r, reveal) {
  const { head, sub } = r.status === 'denied' && !r.passport
    ? { head: 'Ledgerly needs your permission to score your records.', sub: 'Turn on “Work out my credit passport” in Settings, then ask again.' }
    : headline(r);
  $('#answer').textContent = head;
  $('#answer-sub').textContent = sub;
  if (document.activeElement !== $('#goal')) $('#goal').value = S.last?.goal ?? '';
  const w = $('#answer-wrap');
  if (reveal) { w.classList.remove('reveal'); void w.offsetWidth; w.classList.add('reveal'); }
}

// ---------------------------------------------------------------- charts
function el(name, attrs = {}, parent) {
  const n = document.createElementNS(svgNS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

function niceTicks(lo, hi, count = 5) {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const ticks = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-6; v += step) ticks.push(Math.round(v));
  if (ticks.at(-1) < hi) ticks.push(ticks.at(-1) + step);
  return ticks;
}

const tip = $('#tip');
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let left = x + 16, top = y - r.height - 12;
  if (left + r.width > innerWidth - 8) left = x - r.width - 16;
  if (top < 8) top = y + 16;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${top}px`;
}
const hideTip = () => { tip.hidden = true; };

function renderForecast(r) {
  const box = $('#fc-chart');
  box.innerHTML = '';
  const fw = r.forecast_weeks;
  if (!fw) { $('#fc-sub').textContent = ''; $('#fc-table').innerHTML = ''; return; }
  const first = fw.base[0].week_start;
  const dates = [addWeeks(first, -1), ...fw.base.map((w) => w.week_start)];
  const vals = Object.fromEntries(SERIES.map((s) => [s.key, [S.opening, ...fw[s.key].map((w) => w.closing)]]));
  const buffer = r.forecast.base.safety_buffer;

  $('#fc-sub').textContent = `Starting from ${naira(S.opening)} today. The dashed line is your safety buffer: two weeks of costs, about ${naira(buffer)}.`;
  $('#fc-legend').innerHTML = SERIES.map((s) => `<li><span class="key-line" style="color:${s.css}"></span>${s.name}</li>`).join('')
    + '<li><span class="key-dash"></span>Safety buffer</li>';

  const W = Math.max(300, box.clientWidth);
  const narrow = W < 560;
  const H = narrow ? 280 : 340;
  const m = { t: 16, r: narrow ? 14 : 132, b: 30, l: narrow ? 46 : 58 };
  const all = [...Object.values(vals).flat(), buffer, 0];
  const ticks = niceTicks(Math.min(...all), Math.max(...all), narrow ? 4 : 5);
  const y0 = ticks[0], y1 = ticks.at(-1);
  const n = dates.length;
  const X = (i) => m.l + (i / (n - 1)) * (W - m.l - m.r);
  const Y = (v) => m.t + (1 - (v - y0) / (y1 - y0)) * (H - m.t - m.b);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Cash forecast for 13 weeks. Expected low ${naira(r.forecast.base.min_balance)}; with weaker sales the low is ${naira(r.forecast.downside.min_balance)} in the week of ${shortDate(r.forecast.downside.min_week)}.` });
  const grid = el('g', { class: 'grid' }, svg);
  for (const t of ticks) {
    el('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? 'axis-zero' : '' }, grid);
    const tx = el('text', { x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end' }, svg);
    tx.textContent = nairaShort(t);
  }
  // danger zone below the buffer
  el('rect', { class: 'zone', x: m.l, y: Y(buffer), width: W - m.l - m.r, height: Math.max(0, Y(y0) - Y(buffer)) }, svg);
  const zl = el('text', { x: m.l + 8, y: Math.min(Y(buffer) + 16, H - m.b - 6), class: 'lbl', fill: 'var(--s-down)' }, svg);
  zl.textContent = 'Below safety buffer';
  el('line', { class: 'buffer', x1: m.l, x2: W - m.r, y1: Y(buffer), y2: Y(buffer) }, svg);

  // x labels
  const every = narrow ? 3 : 2;
  dates.forEach((d, i) => {
    if (i % every) return;
    const t = el('text', { x: X(i), y: H - 8, 'text-anchor': i === 0 ? 'start' : 'middle' }, svg);
    t.textContent = i === 0 ? 'Today' : shortDate(d);
  });

  // lines (downside drawn last so the risk line sits on top)
  for (const s of [SERIES[2], SERIES[0], SERIES[1]]) {
    const d = vals[s.key].map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    el('path', { d, class: 'series', stroke: s.css }, svg);
  }

  // lowest point on the weak-sales line
  const dv = vals.downside;
  const li = dv.indexOf(Math.min(...dv));
  el('circle', { cx: X(li), cy: Y(dv[li]), r: 5, fill: 'var(--s-down)', class: 'dot' }, svg);
  const lowLbl = el('text', { x: X(li), y: Y(dv[li]) + 22, 'text-anchor': li > n - 3 ? 'end' : 'middle', class: 'lbl-ink' }, svg);
  lowLbl.textContent = `Lowest ${naira(dv[li])}`;

  // direct labels at the right edge, nudged apart
  if (!narrow) {
    const ends = SERIES.map((s) => ({ s, y: Y(vals[s.key][n - 1]) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 16) ends[i].y = ends[i - 1].y + 16;
    for (const e of ends) {
      const t = el('text', { x: W - m.r + 10, y: e.y + 4, class: 'lbl', fill: e.s.css }, svg);
      t.textContent = e.s.name;
    }
  }

  // hover layer
  const cross = el('line', { class: 'crosshair', y1: m.t, y2: H - m.b, visibility: 'hidden' }, svg);
  const dots = SERIES.map((s) => el('circle', { r: 4.5, fill: s.css, class: 'dot', visibility: 'hidden' }, svg));
  const hit = el('rect', { class: 'hit', x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b }, svg);
  const move = (ev) => {
    const pt = svg.getBoundingClientRect();
    const sx = ((ev.clientX - pt.left) / pt.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((sx - m.l) / (W - m.l - m.r)) * (n - 1))));
    cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
    SERIES.forEach((s, k) => { dots[k].setAttribute('cx', X(i)); dots[k].setAttribute('cy', Y(vals[s.key][i])); dots[k].setAttribute('visibility', 'visible'); });
    const head = i === 0 ? 'Today' : `Week of ${shortDate(dates[i])}`;
    showTip(`<strong>${head}</strong>${SERIES.map((s) => `<div class="tip-row"><span><i class="tip-sw" style="background:${s.css}"></i>${s.name}</span><span>${naira(vals[s.key][i])}</span></div>`).join('')}<div class="tip-row"><span>Safety buffer</span><span>${naira(buffer)}</span></div>`, ev.clientX, ev.clientY);
  };
  const leave = () => { cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); hideTip(); };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', leave);
  box.appendChild(svg);

  // table view
  $('#fc-table').innerHTML = `<table><thead><tr><th>Week starting</th><th>Money in (expected)</th><th>Money out</th>${SERIES.map((s) => `<th>${s.name}</th>`).join('')}</tr></thead><tbody>`
    + fw.base.map((w, i) => `<tr><td>${longDate(w.week_start)}</td><td>${naira(w.inflow)}</td><td>${naira(w.outflow)}</td>${SERIES.map((s) => {
      const v = fw[s.key][i].closing;
      return `<td class="${v < buffer ? 'neg' : ''}">${naira(v)}</td>`;
    }).join('')}</tr>`).join('') + '</tbody></table>';
}

function renderMonthly() {
  const box = $('#mo-chart');
  box.innerHTML = '';
  const ms = S.monthly;
  if (!ms.length) return;
  const peak = ms.reduce((a, b) => (b.revenue > a.revenue ? b : a));
  const avg = ms.reduce((a, b) => a + b.revenue, 0) / ms.length;
  $('#mo-sub').textContent = `Average ${naira(avg)} a month. Best month: ${MONTHS_LONG[d8(peak.month + '-01').m - 1]} at ${naira(peak.revenue)}.`;
  const W = Math.max(280, box.clientWidth), H = 190;
  const m = { t: 22, r: 4, b: 26, l: 4 };
  const max = peak.revenue * 1.08;
  const n = ms.length, slot = (W - m.l - m.r) / n, bw = Math.max(6, Math.min(34, slot - 6));
  const Y = (v) => m.t + (1 - v / max) * (H - m.t - m.b);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Monthly sales for ${n} months, peaking at ${naira(peak.revenue)} in ${peak.month}.` });
  el('line', { x1: m.l, x2: W - m.r, y1: Y(0), y2: Y(0), class: 'axis-zero' }, svg);
  ms.forEach((mo, i) => {
    const cx = m.l + slot * (i + 0.5), x = cx - bw / 2, y = Y(mo.revenue), h = Y(0) - y, r = Math.min(4, h);
    const hitR = el('rect', { class: 'bar-hit', x: m.l + slot * i, y: m.t, width: slot, height: H - m.t - m.b }, svg);
    const bar = el('path', { class: `bar${mo === peak ? ' peak' : ''}`, d: `M${x},${Y(0)}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${Y(0)}Z` }, svg);
    const { y: yy, m: mm } = d8(mo.month + '-01');
    const lab = el('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }, svg);
    lab.textContent = n > 9 && W < 420 ? MONTHS[mm - 1][0] : MONTHS[mm - 1];
    if (mo === peak) { const t = el('text', { x: cx, y: y - 6, 'text-anchor': 'middle', class: 'lbl-ink' }, svg); t.textContent = nairaShort(mo.revenue); }
    const show = (ev) => { bar.classList.add('is-hover'); showTip(`<strong>${MONTHS_LONG[mm - 1]} ${yy}</strong><div class="tip-row"><span>Sales</span><span>${naira(mo.revenue)}</span></div><div class="tip-row"><span>After running costs</span><span>${naira(mo.op_cash)}</span></div>`, ev.clientX, ev.clientY); };
    hitR.addEventListener('pointermove', show);
    hitR.addEventListener('pointerdown', show);
    hitR.addEventListener('pointerleave', () => { bar.classList.remove('is-hover'); hideTip(); });
  });
  box.appendChild(svg);
}

// ---------------------------------------------------------------- passport & alerts
const GRADE_TEXT = {
  A: 'Strong. Your records show steady, profitable trading that lenders can check.',
  B: 'Good. A few factors hold the score back; the tips below show which.',
  C: 'Fair. Some lenders will consider you, often at higher cost.',
  D: 'Weak for now. Keep recording every sale and expense and the score will move.',
};

function renderPassport(r) {
  const p = r.passport;
  const box = $('#passport');
  if (!p) {
    box.innerHTML = '<h2 id="pp-title">Cash-flow credit passport</h2><p class="muted">Not scored. Turn on “Work out my credit passport” in Settings to see it.</p>';
    return;
  }
  box.innerHTML = `
    <h2 id="pp-title">Cash-flow credit passport</h2>
    <div class="pp-top">
      <div class="pp-score"><b class="num">${p.score}</b><span>out of 100</span></div>
      <div class="stamp" data-grade="${p.grade}" aria-label="Grade ${p.grade}">${p.grade}</div>
      <p class="pp-meaning">${GRADE_TEXT[p.grade]} Built from your transactions only, never from gender, age or where you live.</p>
    </div>
    <ul class="factors">${p.factors.map((f) => `
      <li class="factor">
        <div class="factor-top"><span>${esc(f.label)}</span><span class="num">${f.points} of ${f.weight}</span></div>
        <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="${f.weight}" aria-valuenow="${f.points}" aria-label="${esc(f.label)}"><i class="${f.score01 < 0.5 ? 'low' : ''}" style="width:${Math.max(2, f.score01 * 100)}%"></i></div>
        <p>${esc(f.explanation)}</p>
      </li>`).join('')}
    </ul>
    <div class="improve"><h3>How to raise your score</h3><ul>${p.improve.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
}

function renderAlerts(r) {
  const a = r.alerts ?? [];
  $('#alerts').innerHTML = a.length
    ? a.map((x) => `<li class="alert" data-sev="${x.severity}">${ICON[x.severity]}<div><span class="alert-sev">${SEV[x.severity]}</span>${esc(x.msg.replace(/\d{4}-\d{2}-\d{2}/g, longDate))}</div></li>`).join('')
    : `<li class="alert alert-ok">${ICON.ok}<div><span class="alert-sev">All clear</span>No cash risks in the next 13 weeks.</div></li>`;
}

// ---------------------------------------------------------------- financing & approval
function renderFinancing(r) {
  const box = $('#financing');
  const m = r.match;
  const p = r.passport;
  if (!m) {
    box.innerHTML = `<div class="fin-head"><h2 id="fin-title">Financing</h2></div>
      <div class="notice">${r.status === 'denied' && !p ? 'Ledgerly needs your permission to score your records before it can compare loans.'
        : 'This question did not ask about money. To compare loans, ask something like <strong>“Do I need a loan for December?”</strong>'}</div>`;
    return;
  }
  const cap = p.weekly_repayment_capacity;
  if (!m.offers.length) {
    box.innerHTML = `<div class="fin-head"><h2 id="fin-title">${m.need ? `No match for a ${naira(m.need)} gap` : 'No loan needed'}</h2></div><div class="notice">${esc(m.note)}</div>`;
    return;
  }
  const best = m.offers[0];
  const rows = m.offers.map((o, i) => {
    const fit = o.affordable && o.covers_need ? '<span class="tag tag-good">Fits your budget</span>'
      : o.affordable ? '<span class="tag tag-warn">Covers part of the gap</span>' : '<span class="tag tag-risk">Over your budget</span>';
    return `<tr class="${i === 0 ? 'best' : ''}">
      <td><span class="offer-name">${esc(o.name)}${i === 0 ? '<span class="tag tag-best">Best fit</span>' : ''}<small>${o.days_to_fund ? `Paid in ${o.days_to_fund} day${o.days_to_fund > 1 ? 's' : ''}` : 'Same day'}${o.collateral_required ? ', needs collateral' : ''}</small></span></td>
      <td>${naira(o.amount)}</td><td>${o.term_weeks} weeks</td><td>${naira(o.total_cost)}</td><td>${pct(o.effective_apr)}</td><td>${naira(o.weekly_payment)}</td><td>${fit}</td></tr>`;
  }).join('');
  box.innerHTML = `
    <div class="fin-head">
      <h2 id="fin-title">Ways to cover a ${naira(m.need)} gap</h2>
      <p>You can comfortably repay about <strong>${naira(cap)} a week</strong>: half of what the business makes after running costs. Ranked by whether the loan covers the gap, fits that budget, and then by cost.</p>
    </div>
    <div class="offers"><table>
      <thead><tr><th>Option</th><th>Amount</th><th>Term</th><th>Total cost</th><th>Yearly rate</th><th>Weekly payment</th><th>Fit</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${decision(r, best)}`;
  box.querySelector('#approve')?.addEventListener('click', (e) => act('/api/approve', {}, {
    button: e.currentTarget,
    success: (s) => (s.report.submit?.disbursement?.status === 'DISBURSED' ? `Applied. ${naira(s.report.submit.application.amount)} was paid into your sandbox account.` : 'Application sent.'),
  }));
  box.querySelector('#decline')?.addEventListener('click', (e) => act('/api/decline', {}, { button: e.currentTarget, success: 'Nothing was sent. You can apply later.' }));
  box.querySelector('#apply-now')?.addEventListener('click', (e) => {
    $('#goal').value = 'Apply for the best financing option';
    act('/api/run', askBody(), { button: e.currentTarget });
  });
}

function decision(r, best) {
  const pack = r.pack;
  const sub = r.submit;
  if (r.status === 'denied') {
    const step = r.steps.find((s) => s.status === 'blocked');
    return `<div class="notice"><strong>Ledgerly stopped before “${esc(step?.label?.toLowerCase())}”.</strong> ${esc(friendly(step?.reason))}. Change this in Settings if you want it to continue.</div>`;
  }
  if (sub?.application) {
    const a = sub.application, d = sub.disbursement;
    if (a.status === 'APPROVED' && d?.status === 'DISBURSED') {
      return `<div class="decision"><div class="decision-main">
          <span class="done-mark">${ICON.check}</span>
          <h3>Approved and paid in</h3>
          <p>The lender approved your application for the ${esc(best.name.toLowerCase())}. This is a sandbox, so no real money moved.</p>
          <div class="decision-figs">
            <div><span>Paid in</span><b class="num">${naira(a.amount)}</b></div>
            <div><span>Account balance now</span><b class="num">${naira(d.new_balance)}</b></div>
            <div><span>Reference</span><b>${esc(a.ref)}</b></div>
          </div></div>
        <div class="decision-side">${shared(pack)}</div></div>`;
    }
    return `<div class="notice"><strong>The lender said ${esc(a.status.toLowerCase())}.</strong> Reference ${esc(a.ref)}. Nothing was paid in.</div>`;
  }
  if (sub?.status === 'SKIPPED') return '<div class="notice">There was no eligible offer to apply for.</div>';
  if (r.status === 'pending_approval') {
    const o = pack.request;
    if (S.decision === 'declined') {
      return `<div class="notice"><strong>You chose not to apply.</strong> Nothing was sent to the lender. <button class="btn btn-quiet" id="approve" type="button" style="margin-left:.5rem">Apply after all</button></div>`;
    }
    return `<div class="decision">
      <div class="decision-main">
        <h3>Apply for the ${esc(o.name.toLowerCase())}?</h3>
        <p>Ledgerly has the application ready. Nothing is sent until you approve. The lender and the payment are simulated in this demo.</p>
        <div class="decision-figs">
          <div><span>You borrow</span><b class="num">${naira(o.amount)}</b></div>
          <div><span>You repay</span><b class="num">${naira(o.weekly_payment)} a week</b></div>
          <div><span>For</span><b>${o.term_weeks} weeks</b></div>
          <div><span>Total cost</span><b class="num">${naira(o.total_cost)}</b></div>
        </div>
        <div class="decision-btns">
          <button class="btn btn-gold" id="approve" type="button">Approve and apply</button>
          <button class="btn btn-quiet" id="decline" type="button">Not now</button>
        </div>
      </div>
      <div class="decision-side">${shared(pack)}</div>
    </div>`;
  }
  if (pack?.request) {
    return `<div class="notice"><strong>Want Ledgerly to apply for the ${esc(best.name.toLowerCase())}?</strong> It will prepare everything and wait for your approval before sending.
      <button class="btn btn-quiet" id="apply-now" type="button" style="margin-left:.5rem">Prepare application</button></div>`;
  }
  return '';
}

function shared(pack) {
  if (!pack) return '';
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  return `<div><h3>What the lender sees</h3><ul>
      <li>Your passport score (${pack.passport.score}, grade ${pack.passport.grade}) and why</li>
      <li>Your cash forecast if sales are 20% weaker</li>
      <li>The loan you are asking for</li>
      <li>${esc(pack.business.name)}, ${esc(pack.business.sector)}, ${esc(pack.business.city)}</li></ul></div>
    <div><h3>What stays with you</h3><ul>${pack.excluded_from_pack.map((x) => `<li>${esc(cap(x))}</li>`).join('')}</ul></div>`;
}

// ---------------------------------------------------------------- behind the scenes
const REASONS = {
  'owner has not consented to share_with_lender': 'You have not allowed Ledgerly to prepare a summary for lenders',
  'owner has not consented to credit_assessment': 'You have not allowed Ledgerly to work out your credit passport',
};
const friendly = (r) => REASONS[r] ?? r;
const STEP_STATUS = { done: 'Done', waiting: 'Waiting for your approval', blocked: 'Blocked', not_run: 'Not run' };

function renderSteps(r) {
  $('#steps').innerHTML = (r.steps ?? []).map((s) => `
    <li data-status="${s.status}">
      <span class="step-title">${esc(s.label)}</span>
      <span class="step-meta">${STEP_STATUS[s.status]}${s.reason ? `: ${esc(friendly(s.reason))}` : ''}. ${TIER_TEXT[s.tier]}.</span>
    </li>`).join('');
}

function auditText(e) {
  const d = e.detail ?? {};
  const label = (t) => (S.tools[t]?.label ?? t).toLowerCase();
  switch (e.action) {
    case 'goal': return `Asked: “${esc(d.goal)}”`;
    case 'tool_ok': return `Finished: ${esc(label(d.tool))}`;
    case 'approval_requested': return `Asked your approval to ${esc(label(d.tool))}`;
    case 'paused_pending_approval': return 'Paused until you decide';
    case 'approved': return `You approved: ${esc(label(d.tool))}`;
    case 'declined': return 'You chose not to apply';
    case 'denied': return `Blocked ${esc(label(d.tool))}: ${esc(friendly(d.reason))}`;
    case 'planner_error': return `Planner failed, used the safe default (${esc(d.error)})`;
    default: return esc(e.action);
  }
}

function renderAudit() {
  const { valid, entries } = S.audit;
  const chain = $('#chain');
  chain.className = `chain ${valid ? 'ok' : 'bad'}`;
  chain.innerHTML = valid ? `${ICON.ok.replace('<svg', '<svg width="16" height="16"')} Record intact, ${entries.length} entries checked` : 'Record has been altered';
  $('#audit').innerHTML = [...entries].reverse().map((e) => {
    const t = new Date(e.ts);
    return `<li><time datetime="${esc(e.ts)}">${t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</time>
      <div><span class="who">${e.actor === 'owner' ? 'You' : 'Ledgerly'}</span> ${auditText(e)}<span class="hash" title="${esc(e.hash)}">Fingerprint ${esc(e.hash.slice(0, 16))}, linked to ${esc(e.prev === 'GENESIS' ? 'start of record' : e.prev.slice(0, 8))}</span></div></li>`;
  }).join('');
}

// ---------------------------------------------------------------- inputs
function askBody() {
  const amt = $('#amount').value.trim();
  return { goal: $('#goal').value, requestedAmount: amt === '' ? null : Number(amt), hasCollateral: $('#collateral').checked };
}

$('#chips').innerHTML = EXAMPLES.map((q) => `<button class="chip" type="button">${esc(q)}</button>`).join('');
$('#chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  $('#goal').value = b.textContent;
  act('/api/run', askBody());
});
$('#ask').addEventListener('submit', (e) => {
  e.preventDefault();
  act('/api/run', askBody(), { button: $('#ask-btn') });
});
$('#goal').placeholder = EXAMPLES[0];

$('#file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  if (f.size > 8 * 1024 * 1024) return toast('That file is larger than 8 MB. Split it into smaller periods and upload one.', true);
  act('/api/upload', { filename: f.name, csv: await f.text() }, { success: `Loaded ${f.name}.` });
});

$('#reset').addEventListener('click', (e) => act('/api/reset', {}, { button: e.currentTarget, success: 'Sandbox account reset. Ledgerly asked your last question again.' }));

const dlg = $('#settings');
$('#open-settings').addEventListener('click', () => {
  const f = $('#settings-form');
  f.elements['name'].value = S.business.name;
  f.sector.value = S.business.sector;
  f.city.value = S.business.city;
  f.opening.value = S.opening;
  f.querySelectorAll('[name="consent"]').forEach((c) => { c.checked = S.consent.includes(c.value); });
  $('#set-source').textContent = `Using ${S.source.kind === 'sample' ? 'the sample records' : S.source.name}. Upload your own from the top bar.`;
  dlg.showModal();
});
dlg.addEventListener('close', () => {
  if (dlg.returnValue !== 'save') return;
  const f = $('#settings-form');
  act('/api/settings', {
    name: f.elements['name'].value, sector: f.sector.value, city: f.city.value, opening: f.opening.value,
    consent: [...f.querySelectorAll('[name="consent"]:checked')].map((c) => c.value),
  }, { success: 'Settings saved.' });
});
$('#use-sample').addEventListener('click', () => { dlg.close('cancel'); act('/api/use-sample', {}, { success: 'Switched to the sample records.' }); });

let rz;
addEventListener('resize', () => {
  clearTimeout(rz);
  rz = setTimeout(() => { if (S) { renderForecast(S.report); renderMonthly(); } }, 120);
});

// ---------------------------------------------------------------- boot
api('/api/state').then((s) => { S = s; render(true); }).catch((e) => {
  $('#answer').textContent = 'Ledgerly could not load.';
  $('#answer-sub').textContent = e.message;
});
