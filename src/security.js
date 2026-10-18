// Security & compliance layer: permission tiers, approvals, PII masking,
// prompt-injection screening, consent, and a tamper-evident audit log.
import { createHash } from 'node:crypto';
import { writeFileSync, appendFileSync } from 'node:fs';
import { stableStringify } from './util.js';

export const Tier = Object.freeze({
  READ: 0,      // analyse data already consented
  PREPARE: 1,   // build drafts / packs (no external effect)
  ACT_LOW: 2,   // reversible external effects (owner notifications)
  ACT_MONEY: 3, // financial commitments: ALWAYS needs human approval
});
export const tierName = (t) => Object.keys(Tier).find((k) => Tier[k] === t);

export class PermissionDenied extends Error {
  constructor(msg) { super(msg); this.name = 'PermissionDenied'; }
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE = /\b(?:\+?234|0)[789][01]\d{8}\b/g;
const LONGNUM = /\b\d{10,11}\b/g; // NUBAN account / BVN-like ids
const INJECTION = /(ignore (all |any )?(previous|prior|above)|disregard .{0,30}instructions|system prompt|you are now|transfer (all|everything)|approve (this|the) (loan|application)|send .{0,40}to account)/i;

export function maskPii(text) {
  return String(text).replace(EMAIL, '[email]').replace(PHONE, '[phone]').replace(LONGNUM, '[id]');
}

/** Treat transaction memos as DATA. Instruction-like text is neutralised and flagged. */
export function sanitizeMemo(memo) {
  if (INJECTION.test(memo ?? '')) return ['[redacted: instruction-like text in data field]', true];
  return [maskPii(memo ?? ''), false];
}

export class Consent {
  constructor(purposes, grantedAt = '2026-10-18') {
    this.purposes = new Set(purposes);
    this.grantedAt = grantedAt;
    Object.freeze(this);
  }
  allows(purpose) { return this.purposes.has(purpose); }
}

export class Policy {
  constructor({ maxTier = Tier.ACT_MONEY, approvalTiers = [Tier.ACT_MONEY] } = {}) {
    this.maxTier = maxTier;
    this.approvalTiers = [...approvalTiers];
  }
  check(tool, tier) {
    if (tier > this.maxTier) throw new PermissionDenied(`${tool} needs tier ${tierName(tier)}; session max is ${tierName(this.maxTier)}`);
  }
  needsApproval(tier) { return this.approvalTiers.includes(tier); }
}

const digest = (prev, body) => createHash('sha256').update(prev + stableStringify(body)).digest('hex');

/** Hash-chained, append-only log. Editing any past entry breaks verify(). */
export class AuditLog {
  constructor(path = null) {
    this.entries = [];
    this.path = path;
    if (path) writeFileSync(path, '');
  }

  record(actor, action, detail = {}) {
    const prev = this.entries.length ? this.entries.at(-1).hash : 'GENESIS';
    const safe = JSON.parse(maskPii(JSON.stringify(detail ?? {})));
    const body = { i: this.entries.length, ts: new Date().toISOString().slice(0, 19) + 'Z', actor, action, detail: safe, prev };
    const entry = { ...body, hash: digest(prev, body) };
    this.entries.push(entry);
    if (this.path) appendFileSync(this.path, JSON.stringify(entry) + '\n');
    return entry;
  }

  verify() {
    let prev = 'GENESIS';
    for (const e of this.entries) {
      const { hash, ...body } = e;
      if (body.prev !== prev || digest(prev, body) !== hash) return false;
      prev = hash;
    }
    return true;
  }
}
