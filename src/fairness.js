// Portfolio-level fairness monitoring. Gender is used ONLY here, for aggregate reporting.

export function approvalRates(results) {
  const tot = new Map(), ok = new Map();
  for (const [group, approved] of results) {
    tot.set(group, (tot.get(group) ?? 0) + 1);
    ok.set(group, (ok.get(group) ?? 0) + (approved ? 1 : 0));
  }
  return Object.fromEntries([...tot].map(([g, n]) => [g, ok.get(g) / n]));
}

/** Ratio of approval rates. Below 0.80 breaches the four-fifths rule. */
export function disparateImpact(results, protectedGroup, reference) {
  const r = approvalRates(results);
  if (!(protectedGroup in r) || !(reference in r) || r[reference] === 0) return null;
  return r[protectedGroup] / r[reference];
}
