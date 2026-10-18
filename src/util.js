// Small helpers shared by every module. Dates are calendar days held as UTC midnight,
// so time zones never shift a transaction into another day or week.

const DAY = 86_400_000;

export function parseDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.trim())) throw new Error(`bad date: ${s}`);
  const [y, m, d] = s.trim().split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw new Error(`bad date: ${s}`);
  return dt;
}

export const iso = (d) => d.toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(d.getTime() + n * DAY);
export const daysBetween = (a, b) => Math.round((b.getTime() - a.getTime()) / DAY);
/** Monday = 0 … Sunday = 6 (same convention as Python's date.weekday()). */
export const weekday = (d) => (d.getUTCDay() + 6) % 7;
export const year = (d) => d.getUTCFullYear();
export const month = (d) => d.getUTCMonth() + 1;
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const dateOf = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

export const sum = (xs) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs) => {
  if (!xs.length) throw new Error('mean of empty list');
  return sum(xs) / xs.length;
};
export const pstdev = (xs) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
export const round = (x, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};
export const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));

const commas = (n) => Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export const naira = (x) => `${x < 0 && Math.round(x) !== 0 ? '-' : ''}₦${commas(x)}`;
export const pct = (x, signed = false) => {
  const v = Math.round(x * 100);
  return `${signed && v >= 0 ? '+' : ''}${v}%`;
};

/** JSON with sorted keys, so a hash over it is stable. */
export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}
