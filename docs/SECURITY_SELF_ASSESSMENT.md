# Security Self-Assessment

## Permission tiers
| Tier | Examples | Control |
|---|---|---|
| READ (0) | forecast, passport, alerts, match | Needs `credit_assessment` consent for passport |
| PREPARE (1) | lender pack | Needs `share_with_lender` consent; raw transactions, customer identities, phone/account numbers excluded |
| ACT_LOW (2) | owner notification | Reversible, idempotent |
| ACT_MONEY (3) | lender application, disbursement | **Always** paused for explicit owner approval; session policy can cap below this tier |

## Controls implemented (each has a test)
- Approval gate: nothing moves before approval; balance unchanged in the pending state.
- Policy cap: a session limited to ACT_LOW cannot reach the money tool.
- Consent purposes enforced per tool.
- Planner validation: LLM output cannot add unknown tools, skip dependencies, or exceed tiers; model failure falls back.
- Prompt-injection screening of free-text memos; instruction-like text is replaced and flagged.
- PII masking (phone, email, account/BVN-like numbers) in memos and audit entries.
- Idempotency keys prevent duplicate applications and disbursements; disbursement cap in sandbox.
- Tamper-evident audit log (SHA-256 hash chain; `verify()` fails if any entry is edited).

## Known risks (not solved)
1. Synthetic data only; real mobile-money formats need adapters and validation.
2. Regex PII masking can miss unusual formats; production needs a vetted PII service.
3. Injection screening is pattern-based; a determined attacker may evade it. Mitigation is architectural (data never becomes instructions; money tier needs a human).
4. Audit log is local; production needs append-only external storage and key management.
5. Score is not calibrated on default outcomes; weights are expert-set, not statistically fitted.
6. Seasonal-naive forecast assumes last year repeats; one year of history is thin evidence.
7. Lender catalogue is illustrative; no real lender API, KYC or regulatory review (e.g. CBN, NDPR).
8. Owner approval UI is a callback in the demo, not an authenticated interface.
