// Simulated accounts and lender. NO real money ever moves. Every operation is logged as evidence.
import { writeFileSync, appendFileSync } from 'node:fs';
import { maskPii } from './security.js';

export class SandboxEnv {
  constructor(openingBalance, logPath = null, disbursementCap = 5_000_000) {
    this.balance = openingBalance;
    this.cap = disbursementCap;
    this.logPath = logPath;
    this.ops = [];
    this._idem = new Map();
    this._apps = new Map();
    if (logPath) writeFileSync(logPath, '');
  }

  _log(op, params, result) {
    const e = { ts: new Date().toISOString().slice(0, 19) + 'Z', sandbox: true, op, params: JSON.parse(maskPii(JSON.stringify(params))), result };
    this.ops.push(e);
    if (this.logPath) appendFileSync(this.logPath, JSON.stringify(e) + '\n');
    return e;
  }

  _once(key, op, params, fn) {
    if (this._idem.has(key)) return { ...this._idem.get(key), replayed: true };
    const res = fn();
    this._idem.set(key, res);
    this._log(op, { ...params, idempotency_key: key }, res);
    return res;
  }

  notifyOwner(message, key) {
    return this._once(key, 'notify_owner', { channel: 'sms_sandbox', message }, () => ({ status: 'SENT' }));
  }

  apply(productId, amount, score, minScore, key) {
    return this._once(key, 'lender_application', { product_id: productId, amount }, () => {
      const ref = `SBX-${String(this._apps.size + 1).padStart(4, '0')}`;
      const ok = score >= minScore && amount <= this.cap;
      this._apps.set(ref, { amount, approved: ok, disbursed: false });
      return { ref, status: ok ? 'APPROVED' : 'DECLINED', product_id: productId, amount };
    });
  }

  disburse(ref, key) {
    return this._once(key, 'disbursement', { ref }, () => {
      const a = this._apps.get(ref);
      if (!a || !a.approved || a.disbursed || a.amount > this.cap) return { ref, status: 'REFUSED' };
      a.disbursed = true;
      this.balance += a.amount;
      return { ref, status: 'DISBURSED', new_balance: this.balance };
    });
  }
}
