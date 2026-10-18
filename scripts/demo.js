// End-to-end demo in the terminal (same story as the Python run_demo.py). Writes ./evidence.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent } from '../src/agent.js';
import { loadCsv } from '../src/ingest.js';
import { SandboxEnv } from '../src/sandbox.js';
import { AuditLog, Consent } from '../src/security.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OPENING = 650_000;
const GOAL = 'I need to stock up for the December rush. Do I need financing, and apply for the best option?';

const { txns, quality } = loadCsv(join(ROOT, 'data', 'sample_trader.csv'));
console.log('Data quality:', quality);
const ev = join(ROOT, 'evidence');
mkdirSync(ev, { recursive: true });
const env = new SandboxEnv(OPENING, join(ev, 'execution_log.jsonl'));
const audit = new AuditLog(join(ev, 'audit_log.jsonl'));
const biz = { name: 'Mama Ngozi Fabrics (synthetic)', sector: 'fabric retail', city: 'Lagos', owner_gender: 'female' };
const consent = new Consent(['credit_assessment', 'share_with_lender']);

console.log('\n=== Run 1: owner has NOT approved the money step ===');
const agent = new Agent(biz, txns, OPENING, consent, { env, audit });
const r1 = await agent.run(GOAL);
console.log(r1.summary, '\nstatus:', r1.status);

console.log('\n=== Run 2: owner approves ===');
agent.approver = () => true;
const r2 = await agent.run(GOAL);
console.log(r2.summary, '\nstatus:', r2.status, '| audit chain valid:', r2.audit_chain_valid);
console.log('Sandbox balance:', env.balance);
const { steps, forecast_weeks, history_weeks, ...report } = r2;
writeFileSync(join(ev, 'report.json'), JSON.stringify(report, null, 2));
