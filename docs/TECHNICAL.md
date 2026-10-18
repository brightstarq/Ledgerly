# Technical Documentation

## 1. Architecture
Owner goal -> **Planner** (rule-based or LLM, validated) -> **Tool executor** (tiered, audited) -> **Report**.

Tools and tiers: `forecast`, `passport`, `alerts`, `match` (READ) -> `pack` (PREPARE) -> `notify` (ACT_LOW) ->
`submit` (ACT_MONEY, human approval always required). Dependencies are resolved automatically (`submit` pulls in
`pack`, `match`, `forecast`, `passport`).

## 2. Core algorithms
**Forecast.** With >=52 weeks of history: seasonal-naive. Each future week = the same week last year (3-week
centred average to damp lumpy restocking), scaled by a bounded recent trend (0.8-1.25) when 60+ weeks exist.
With less history: deseasonalised 8-week level x shrunk calendar-month factor. Scenarios: base, downside
(inflows -20%), upside (+10%). `need = max(0, 2-week outflow buffer - minimum downside balance)`.

**Cash-flow credit passport (0-100).** Seven weighted factors: records history (10), revenue stability (20),
operating margin (20), sales trend (10), customer spread (10), debt-service coverage (20), repayment
discipline (10). Every factor returns a plain-language explanation; the two weakest become "how to improve" tips.
Inputs are transaction behaviour only. Gender, age, religion, ethnicity and location are never inputs.

**Matching.** For each product: eligibility (min score, collateral), cap (multiple of monthly revenue), amount =
min(need, cap), total cost = interest + fee, effective APR, weekly payment. Affordable = weekly payment <=
repayment capacity (50% of average weekly operating cash). Ranking: affordable and covers need, then affordable
partial, then others; ties by effective APR.

## 3. Security design
See `SECURITY_SELF_ASSESSMENT.md`. Summary: permission tiers, mandatory human approval for money, consent
purposes, PII masking, memo injection screening, privacy-minimal lender pack, idempotent capped sandbox,
hash-chained audit log.

## 4. Fairness
`fairness.disparate_impact` reports approval-rate ratios by owner group (four-fifths rule). Owner gender is
carried on `Business` for this reporting only; a test proves identical scores for otherwise identical businesses.

## 5. Data
`data/generate_synthetic.py` creates an invented Lagos fabric trader (52 weeks, seasonal December peak, a
Nov restock cash dip) with one poisoned memo to demonstrate injection handling.
