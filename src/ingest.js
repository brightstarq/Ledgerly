// CSV ingestion, categorisation, prompt-injection screening of memos.
import { readFileSync } from 'node:fs';
import { parseDate } from './util.js';
import { sanitizeMemo } from './security.js';

const RULES = [
  ['loan_repayment', ['loan', 'repayment']],
  ['owner_draw', ['owner', 'personal', 'withdrawal']],
  ['supplier', ['supplier', 'restock', 'wholesale']],
  ['rent', ['rent']],
  ['wages', ['wage', 'salary']],
  ['transport', ['transport', 'logistics', 'dispatch', 'fuel']],
];

export function categorize(memo, amount) {
  if (amount > 0) return 'sales';
  const m = String(memo).toLowerCase();
  for (const [cat, keys] of RULES) if (keys.some((k) => m.includes(k))) return cat;
  return 'other';
}

/** Minimal RFC-4180 parser: quoted fields, escaped quotes, CRLF. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.some((x) => x !== ''));
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i]])));
}

/** Columns: date,amount,description,channel,counterparty. Returns { txns, quality }. */
export function loadCsvText(text) {
  const txns = [];
  let bad = 0, injected = 0;
  for (const row of parseCsv(text)) {
    let day, amount;
    try {
      day = parseDate(row.date ?? '');
      const raw = String(row.amount ?? '').replace(/,/g, '').trim();
      amount = Number(raw);
      if (raw === '' || !Number.isFinite(amount)) throw new Error('bad amount');
    } catch {
      bad++;
      continue;
    }
    const [memo, flagged] = sanitizeMemo(row.description ?? '');
    injected += flagged ? 1 : 0;
    txns.push(Object.freeze({
      day, amount, category: categorize(memo, amount),
      channel: (row.channel ?? 'cash').trim() || 'cash',
      counterparty: (row.counterparty ?? '').trim(), memo,
    }));
  }
  txns.sort((a, b) => a.day - b.day);
  return { txns, quality: { rows_loaded: txns.length, rows_rejected: bad, injection_flags: injected } };
}

export const loadCsv = (path) => loadCsvText(readFileSync(path, 'utf8'));
