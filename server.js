// Ledgerly web app: serves the dashboard and a small JSON API around the agent.
// No third-party packages. Start with:  node server.js   (or npm start)
//
// Local mode (no PORT set): opens your browser, listens on localhost and writes ./evidence after each run.
// Hosted mode (PORT set by the platform): listens on all interfaces, no browser, no evidence files.
// Either way every visitor gets their own private session (cookie), so one person's
// approval never shows up on someone else's screen.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
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

const PORT_ENV = (process.env.PORT ?? '').trim();
const HOSTED = PORT_ENV !== '';
const WRITE_EVIDENCE = process.env.LEDGERLY_EVIDENCE ? process.env.LEDGERLY_EVIDENCE !== '0' : !HOSTED;
if (WRITE_EVIDENCE) {
  try { mkdirSync(EVIDENCE, { recursive: true }); } catch { /* read-only disk: evidence is optional */ }
}

const DEFAULT_GOAL = 'I need to stock up for the December rush. Do I need financing, and apply for the best option?';
const PURPOSES = ['credit_assessment', 'share_with_lender'];
const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
const MAX_SESSIONS = 500;

const httpError = (status, message) => Object.assign(new Error(message), { status });

// ---- data
function parseRecords(text) {
  const { txns, quality } = loadCsvText(text);
  if (txns.length < 20) throw httpError(400, `Only ${txns.length} usable rows found. Ledgerly needs at least a few weeks of sales and expenses in the columns date, amount, description, channel, counterparty.`);
  const days = (txns.at(-1).day - txns[0].day) / 86_400_000;
  if (days < 56) throw httpError(400, `These records cover ${Math.round(days)} days. Ledgerly needs at least 8 weeks to forecast cash.`);
  if (!monthly(txns).length) throw httpError(400, 'These records do not cover a single complete month. Add more history and try again.');
  return { txns, quality };
}
const SAMPLE_DATA = parseRecords(readFileSync(SAMPLE, 'utf8')); // parsed once, shared read-only

// ---- sessions
const sessions = new Map();

function evidencePath(name) {
  return WRITE_EVIDENCE ? join(EVIDENCE, name) : null;
}

function safeEvidence(fn) {
  try { return fn(); } catch { return null; } // never let a disk problem break a request
}

function freshAccount(s) {
  s.env = safeEvidence(() => new SandboxEnv(s.opening, evidencePath('execution_log.jsonl'))) ?? new SandboxEnv(s.opening);
  s.audit = safeEvidence(() => new AuditLog(evidencePath('audit_log.jsonl'))) ?? new AuditLog();
  s.agent = new Agent(s.business, s.txns, s.opening, new Consent(s.consent), { env: s.env, audit: s.audit });
  s.report = null;
  s.decision = null;
}

function useData(s, { txns, quality }, source) {
  s.txns = txns; s.quality = quality; s.source = source;
  freshAccount(s);
}

async function newSession() {
  const s = {
    id: randomBytes(18).toString('base64url'),
    seen: Date.now(),
    queue: Promise.resolve(),
    business: { name: 'Mama Ngozi Fabrics (synthetic)', sector: 'fabric retail', city: 'Lagos', owner_gender: 'female' },
    opening: 650_000,
    consent: [...PURPOSES],
    source: null, txns: [], quality: null,
    env: null, audit: null, agent: null,
    last: null, report: null, decision: null,
  };
  useData(s, SAMPLE_DATA, { kind: 'sample', name: 'sample_trader.csv' });
  await run(s, { goal: DEFAULT_GOAL });
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.values()].sort((a, b) => a.seen - b.seen)[0];
    sessions.delete(oldest.id);
  }
  sessions.set(s.id, s);
  return s;
}

setInterval(() => {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  for (const [id, s] of sessions) if (s.seen < cutoff) sessions.delete(id);
}, 10 * 60 * 1000).unref();

function cookieSid(req) {
  const m = /(?:^|;\s*)ledgerly_sid=([A-Za-z0-9_-]{20,64})/.exec(req.headers.cookie ?? '');
  return m ? m[1] : null;
}

// ---- agent runs
async function run(s, { goal, requestedAmount = null, hasCollateral = false }, approve = false) {
  goal = String(goal ?? '').trim().slice(0, 500) || DEFAULT_GOAL;
  s.last = { goal, requestedAmount, hasCollateral };
  s.decision = null;
  s.agent.approver = approve ? () => true : null;
  try {
    s.report = await s.agent.run(goal, { requestedAmount, hasCollateral });
  } finally {
    s.agent.approver = null;
  }
  if (WRITE_EVIDENCE) {
    const { steps, forecast_weeks, history_weeks, ...report } = s.report;
    safeEvidence(() => writeFileSync(join(EVIDENCE, 'report.json'), JSON.stringify(report, null, 2)));
  }
}

function state(s) {
  return {
    business: s.business, opening: s.opening, consent: s.consent, source: s.source, quality: s.quality,
    period: s.txns.length ? { from: s.txns[0].day.toISOString().slice(0, 10), to: s.txns.at(-1).day.toISOString().slice(0, 10) } : null,
    monthly: monthly(s.txns).map((m) => ({ month: m.month, revenue: Math.round(m.revenue), op_cash: Math.round(m.op_cash) })),
    last: s.last, report: s.report, decision: s.decision,
    sandbox: { balance: s.env.balance, ops: s.env.ops },
    audit: { valid: s.audit.verify(), entries: s.audit.entries },
    tools: Object.fromEntries(Object.entries(TOOLS).map(([k, [t, deps]]) => [k, { tier: tierName(t), deps, label: TOOL_INFO[k] }])),
    catalogue: CATALOGUE,
  };
}

// ---- HTTP plumbing
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
  'GET /api/state': async (s) => state(s),

  'POST /api/run': async (s, body) => {
    await run(s, {
      goal: body.goal,
      requestedAmount: num(body.requestedAmount, 'Amount', { min: 0, max: 1e10 }),
      hasCollateral: Boolean(body.hasCollateral),
    });
    return state(s);
  },

  'POST /api/approve': async (s) => {
    if (s.report?.status !== 'pending_approval' || !s.last) throw httpError(409, 'There is nothing waiting for approval. Ask Ledgerly a question first.');
    await run(s, s.last, true);
    return state(s);
  },

  'POST /api/decline': async (s) => {
    if (s.report?.status !== 'pending_approval') throw httpError(409, 'There is nothing waiting for approval.');
    s.audit.record('owner', 'declined', { tool: s.report.pending });
    s.decision = 'declined';
    return state(s);
  },

  'POST /api/settings': async (s, body) => {
    const opening = num(body.opening, 'Opening balance', { min: 0, max: 1e11 });
    if (opening !== null) s.opening = opening;
    const text = (v, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);
    s.business = {
      ...s.business,
      name: text(body.name, 80) ?? s.business.name,
      sector: text(body.sector, 60) ?? s.business.sector,
      city: text(body.city, 60) ?? s.business.city,
    };
    if (Array.isArray(body.consent)) s.consent = PURPOSES.filter((p) => body.consent.includes(p));
    freshAccount(s);
    if (s.last) await run(s, s.last);
    return state(s);
  },

  'POST /api/upload': async (s, body) => {
    if (typeof body.csv !== 'string' || !body.csv.trim()) throw httpError(400, 'The file is empty.');
    useData(s, parseRecords(body.csv), { kind: 'upload', name: String(body.filename ?? 'upload.csv').slice(0, 120) });
    await run(s, s.last ?? { goal: DEFAULT_GOAL });
    return state(s);
  },

  'POST /api/use-sample': async (s) => {
    useData(s, SAMPLE_DATA, { kind: 'sample', name: 'sample_trader.csv' });
    await run(s, s.last ?? { goal: DEFAULT_GOAL });
    return state(s);
  },

  'POST /api/reset': async (s) => {
    freshAccount(s);
    await run(s, s.last ?? { goal: DEFAULT_GOAL });
    return state(s);
  },
};

async function serveStatic(req, res, path) {
  if (path === '/healthz') return send(res, 200, { ok: true });
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
    if (handler) {
      const body = req.method === 'POST' ? await readJson(req) : {};
      let s = sessions.get(cookieSid(req));
      const extra = {};
      if (!s) {
        s = await newSession();
        const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
        extra['Set-Cookie'] = `ledgerly_sid=${s.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_IDLE_MS / 1000}${secure}`;
      }
      s.seen = Date.now();
      // one request at a time per visitor, so a double click can't interleave two runs
      const result = s.queue.then(() => handler(s, body));
      s.queue = result.catch(() => {});
      return send(res, 200, await result, undefined, extra);
    }
    if (pathname.startsWith('/api/')) return send(res, 404, { error: 'Unknown API route.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    await serveStatic(req, res, pathname);
  } catch (e) {
    if (!e.status) console.error(e);
    send(res, e.status ?? 500, { error: e.status ? e.message : 'Something went wrong on the server. Check the server log for details.' });
  }
});

// ---- start
const HOST = process.env.LEDGERLY_HOST || (HOSTED ? undefined : '127.0.0.1');
let port = HOSTED ? Number(PORT_ENV) : 3000;
const noOpen = HOSTED || process.argv.includes('--no-open') || process.env.NO_OPEN || process.env.CI;

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && !HOSTED && port < 3010) {
    port += 1;
    server.listen(port, HOST);
  } else {
    console.error(e.message);
    process.exit(1);
  }
});

server.on('listening', () => {
  const url = `http://localhost:${port}`;
  console.log(HOSTED ? `Ledgerly listening on port ${port}` : `\n  Ledgerly is running at ${url}\n  Press Ctrl+C to stop.\n`);
  if (noOpen) return;
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
});

server.listen(port, HOST);
