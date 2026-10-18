// Ledgerly web app: serves the dashboard and a small JSON API around the agent.
// No third-party packages. Start with:  node server.js   (or npm start)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { Agent, TOOLS, TOOL_INFO } from './src/agent.js';
import { monthly } from './src/analysis.js';
import { CATALOGUE } from './src/financing.js';
import { loadCsvText } from './src/ingest.js';
import { SandboxEnv } from './src/sandbox.js';
import { AuditLog, Consent, tierName } from './src/security.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const EVIDENCE = join(ROOT, 'evidence');
const SAMPLE = join(ROOT, 'data', 'sample_trader.csv');
mkdirSync(EVIDENCE, { recursive: true });

const DEFAULT_GOAL = 'I need to stock up for the December rush. Do I need financing, and apply for the best option?';
const PURPOSES = ['credit_assessment', 'share_with_lender'];

// ---- session state (one owner, one local session)
const S = {
  business: { name: 'Mama Ngozi Fabrics (synthetic)', sector: 'fabric retail', city: 'Lagos', owner_gender: 'female' },
  opening: 650_000,
  consent: [...PURPOSES],
  source: { kind: 'sample', name: 'sample_trader.csv' },
  txns: [], quality: null,
  env: null, audit: null, agent: null,
  last: null,       // { goal, requestedAmount, hasCollateral }
  report: null,
  decision: null,   // 'declined' after the owner says "not now"
};

function freshSession() {
  S.env = new SandboxEnv(S.opening, join(EVIDENCE, 'execution_log.jsonl'));
  S.audit = new AuditLog(join(EVIDENCE, 'audit_log.jsonl'));
  S.agent = new Agent(S.business, S.txns, S.opening, new Consent(S.consent), { env: S.env, audit: S.audit });
  S.report = null;
  S.decision = null;
}

function loadData(text, source) {
  const { txns, quality } = loadCsvText(text);
  if (txns.length < 20) throw httpError(400, `Only ${txns.length} usable rows found. Ledgerly needs at least a few weeks of sales and expenses in the columns date, amount, description, channel, counterparty.`);
  const days = (txns.at(-1).day - txns[0].day) / 86_400_000;
  if (days < 56) throw httpError(400, `These records cover ${Math.round(days)} days. Ledgerly needs at least 8 weeks to forecast cash.`);
  if (!monthly(txns).length) throw httpError(400, 'These records do not cover a single complete month. Add more history and try again.');
  S.txns = txns; S.quality = quality; S.source = source;
  freshSession();
}

async function run({ goal, requestedAmount = null, hasCollateral = false }, approve = false) {
  goal = String(goal ?? '').trim().slice(0, 500) || DEFAULT_GOAL;
  S.last = { goal, requestedAmount, hasCollateral };
  S.decision = null;
  S.agent.approver = approve ? () => true : null;
  try {
    S.report = await S.agent.run(goal, { requestedAmount, hasCollateral });
  } finally {
    S.agent.approver = null;
  }
  const { steps, forecast_weeks, history_weeks, ...report } = S.report;
  writeFileSync(join(EVIDENCE, 'report.json'), JSON.stringify(report, null, 2));
}

function state() {
  return {
    business: S.business, opening: S.opening, consent: S.consent, source: S.source, quality: S.quality,
    period: S.txns.length ? { from: S.txns[0].day.toISOString().slice(0, 10), to: S.txns.at(-1).day.toISOString().slice(0, 10) } : null,
    monthly: monthly(S.txns).map((m) => ({ month: m.month, revenue: Math.round(m.revenue), op_cash: Math.round(m.op_cash) })),
    last: S.last, report: S.report, decision: S.decision,
    sandbox: { balance: S.env.balance, ops: S.env.ops },
    audit: { valid: S.audit.verify(), entries: S.audit.entries },
    tools: Object.fromEntries(Object.entries(TOOLS).map(([k, [t, deps]]) => [k, { tier: tierName(t), deps, label: TOOL_INFO[k] }])),
    catalogue: CATALOGUE,
  };
}

// ---- HTTP plumbing
const httpError = (status, message) => Object.assign(new Error(message), { status });
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.csv': 'text/csv; charset=utf-8' };

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(data);
}

async function readJson(req, limit = 8 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw httpError(413, 'That file is larger than 8 MB. Split it into smaller periods and upload one.');
    chunks.push(c);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw httpError(400, 'Request body is not valid JSON.'); }
}

const num = (v, name, { min = -Infinity, max = Infinity } = {}) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw httpError(400, `${name} must be a number between ${min} and ${max}.`);
  return n;
};

const routes = {
  'GET /api/state': () => state(),

  'POST /api/run': async (body) => {
    await run({
      goal: body.goal,
      requestedAmount: num(body.requestedAmount, 'Amount', { min: 0, max: 1e10 }),
      hasCollateral: Boolean(body.hasCollateral),
    });
    return state();
  },

  'POST /api/approve': async () => {
    if (S.report?.status !== 'pending_approval' || !S.last) throw httpError(409, 'There is nothing waiting for approval. Ask Ledgerly a question first.');
    await run(S.last, true);
    return state();
  },

  'POST /api/decline': async () => {
    if (S.report?.status !== 'pending_approval') throw httpError(409, 'There is nothing waiting for approval.');
    S.audit.record('owner', 'declined', { tool: S.report.pending });
    S.decision = 'declined';
    return state();
  },

  'POST /api/settings': async (body) => {
    const opening = num(body.opening, 'Opening balance', { min: 0, max: 1e11 });
    if (opening !== null) S.opening = opening;
    if (typeof body.name === 'string' && body.name.trim()) S.business = { ...S.business, name: body.name.trim().slice(0, 80) };
    if (typeof body.sector === 'string' && body.sector.trim()) S.business = { ...S.business, sector: body.sector.trim().slice(0, 60) };
    if (typeof body.city === 'string' && body.city.trim()) S.business = { ...S.business, city: body.city.trim().slice(0, 60) };
    if (Array.isArray(body.consent)) S.consent = PURPOSES.filter((p) => body.consent.includes(p));
    freshSession();
    if (S.last) await run(S.last);
    return state();
  },

  'POST /api/upload': async (body) => {
    if (typeof body.csv !== 'string' || !body.csv.trim()) throw httpError(400, 'The file is empty.');
    loadData(body.csv, { kind: 'upload', name: String(body.filename ?? 'upload.csv').slice(0, 120) });
    await run(S.last ?? { goal: DEFAULT_GOAL });
    return state();
  },

  'POST /api/use-sample': async () => {
    loadData(readFileSync(SAMPLE, 'utf8'), { kind: 'sample', name: 'sample_trader.csv' });
    await run(S.last ?? { goal: DEFAULT_GOAL });
    return state();
  },

  'POST /api/reset': async () => {
    freshSession();
    await run(S.last ?? { goal: DEFAULT_GOAL });
    return state();
  },
};

async function serveStatic(req, res, path) {
  if (path === '/sample.csv') {
    return send(res, 200, await readFile(SAMPLE), MIME['.csv'], { 'Content-Disposition': 'attachment; filename="ledgerly-template.csv"' });
  }
  const rel = path === '/' ? 'index.html' : decodeURIComponent(path).replace(/^\/+/, '');
  const file = normalize(join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + sep)) return send(res, 403, { error: 'Forbidden' });
  try {
    if (!(await stat(file)).isFile()) throw new Error();
    send(res, 200, await readFile(file), MIME[extname(file)] ?? 'application/octet-stream');
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const handler = routes[`${req.method} ${pathname}`];
  try {
    if (handler) return send(res, 200, await handler(req.method === 'POST' ? await readJson(req) : {}));
    if (pathname.startsWith('/api/')) return send(res, 404, { error: 'Unknown API route.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    await serveStatic(req, res, pathname);
  } catch (e) {
    if (!e.status) console.error(e);
    send(res, e.status ?? 500, { error: e.status ? e.message : 'Something went wrong on the server. Check the terminal for details.' });
  }
});

// ---- start
loadData(readFileSync(SAMPLE, 'utf8'), { kind: 'sample', name: 'sample_trader.csv' });
await run({ goal: DEFAULT_GOAL });

const HOST = process.env.HOST ?? '127.0.0.1';
let port = Number(process.env.PORT ?? 3000);
const noOpen = process.argv.includes('--no-open') || process.env.NO_OPEN;

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && !process.env.PORT && port < 3010) {
    port += 1;
    server.listen(port, HOST);
  } else {
    console.error(e.message);
    process.exit(1);
  }
});

server.on('listening', () => {
  const url = `http://localhost:${port}`;
  console.log(`\n  Ledgerly is running at ${url}\n  Press Ctrl+C to stop.\n`);
  if (noOpen) return;
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
});

server.listen(port, HOST);
