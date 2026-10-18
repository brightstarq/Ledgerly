# Ledgerly: SME Finance Copilot (FinTechathon 2026, International Track, Topic E)

**Problem.** The IFC/World Bank estimates a ~US$5.7 trillion finance gap for formal MSMEs in emerging economies,
plus ~US$2.1 trillion more from informal firms. Lenders cannot underwrite businesses with no credit history or
collateral, even when their cash flow is healthy.

**Solution.** Ledgerly is an AI agent that works on the *borrower's* side. It turns messy sales and expense
records (POS, mobile money, cash notes) into an explainable **cash-flow credit passport**, forecasts cash
13 weeks ahead under three scenarios, raises alerts, matches financing options by true cost and affordability,
prepares a privacy-minimal lender pack, and, only after explicit owner approval, applies in a sandbox.

This is the Node.js version, with a web dashboard. It gives exactly the same numbers as the original Python
version on the sample data (score 83.2, ₦880,000 gap, microfinance group loan, sandbox balance ₦1,530,000).

## Run it (Node.js 18 or newer, no packages to install)

Install Node.js once if you don't have it (Windows: `winget install OpenJS.NodeJS.LTS`, then reopen the terminal).
Then, from this folder:

```bash
npm start          # opens the dashboard at http://localhost:3000
npm test           # 25 tests (the original 24 + a check that results match the Python version)
npm run demo       # the original terminal demo; writes ./evidence
```

`npm start` is the same as `node server.js`. If port 3000 is busy it tries 3001, 3002 and so on.
Stop the server with Ctrl+C. Add `--no-open` (`node server.js --no-open`) to stop it opening a browser tab.

## Using the dashboard

- **Ask a question** in the box at the top, or click an example. Ledgerly plans the steps it needs, runs them
  and answers in plain language.
- **Cash forecast:** expected, weak-sales (−20%) and strong-sales (+10%) lines against the safety buffer.
  Hover for weekly figures; "Show the numbers" gives the table.
- **Credit passport:** the 7-factor score with an explanation for each factor and the two biggest levers.
- **Financing:** every eligible option, ranked. Applying needs you to click **Approve and apply**; nothing
  moves before that. "Not now" logs the decision and sends nothing.
- **What Ledgerly did:** each step with its permission tier, and the hash-chained activity record.
- **Upload records** takes your own CSV with the columns `date,amount,description,channel,counterparty`
  (money in positive, money out negative). Settings has a template download, the opening balance,
  the business details and the two consent switches. Turning a consent off shows how the agent stops.
- **Reset sandbox account** clears the simulated account and record and asks your last question again.

## Layout

| Path | Purpose |
|---|---|
| `server.js` | Web server and JSON API (`/api/state`, `/api/run`, `/api/approve`, `/api/decline`, `/api/upload`, `/api/settings`, `/api/reset`) |
| `public/` | Dashboard: `index.html`, `styles.css`, `app.js` (plain JS, no build step) |
| `src/ingest.js` | CSV ingestion, categorisation, prompt-injection screening of memos |
| `src/analysis.js` | Monthly/weekly metrics |
| `src/forecast.js` | 13-week cash forecast (seasonal-naive), base/downside/upside |
| `src/passport.js` | 7-factor explainable score (transaction behaviour only) |
| `src/financing.js` | Offer matching: eligibility, total cost, effective APR, affordability |
| `src/agent.js` | Planner, tiered tool execution, approvals, narration |
| `src/security.js` | Permission tiers, consent, PII masking, hash-chained audit log |
| `src/sandbox.js` | Simulated accounts/lender (no real money), idempotent, capped |
| `src/fairness.js` | Portfolio disparate-impact monitoring |
| `data/sample_trader.csv` | The synthetic trader used by the demo (same file as the Python version) |
| `data/generate-synthetic.js` | Seeded generator for more synthetic traders (`npm run generate`) |
| `test/` | Test suite (`node:test`) |
| `scripts/demo.js` | Terminal demo |
| `docs/` | Technical documentation, security self-assessment, deck outline (written for the Python version; the design is unchanged) |
| `evidence/` | Sandbox execution log, audit log and report from the latest run |

## Optional LLM planner
`new Agent(..., { llmPlanner: fn })` where `fn(goal, toolNames)` returns (or resolves to) a list of tool names.
Output is validated: unknown tools are dropped, dependencies are added, and permission tiers still apply.
If the model fails, the rule-based planner runs.

## Limits (honest)
Synthetic data only; illustrative product catalogue; one year of history gives thin seasonality evidence;
no real lender integration. One local session at a time (state lives in the server's memory). The dashboard
loads its fonts from Google Fonts and falls back to system fonts when offline. See `docs/SECURITY_SELF_ASSESSMENT.md`.
