// ═══════════════════════════════════════════════════════════════════════════
// FORGE — who's reading the guide, and which rules they get wrong
//
//   node scripts/guide-stats.mjs              # prod, last 14 days
//   node scripts/guide-stats.mjs --days 30    # longer window
//   node scripts/guide-stats.mjs --staging    # test data
//
// Reads the plain daily counters guide.html writes. No personal data exists in
// these docs — they are integers only.
//
// The per-question column is the useful one: a question most people get wrong
// means the RULE is unclear, not that the readers are. That's a signal to
// reword the guide (or reconsider the rule).
// ═══════════════════════════════════════════════════════════════════════════
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
const ARGS = process.argv.slice(2);
const STAGING = ARGS.includes('--staging');
const DAYS = Number((ARGS[ARGS.indexOf('--days') + 1]) || 14);
const PID = STAGING ? 'forge-staging-865ff' : 'forge-25c8c';
const API = 'https://firestore.googleapis.com/v1';
const ROOT = `projects/${PID}/databases/(default)/documents`;

let TOKEN;
try { TOKEN = (await run('gcloud', ['auth', 'print-access-token'], { timeout: 20000 })).stdout.trim(); }
catch { console.error('Run: gcloud auth login'); process.exit(1); }
const H = { Authorization: `Bearer ${TOKEN}` };
const n = v => v ? Number(Object.values(v)[0]) : 0;

const r = await fetch(`${API}/${ROOT}/guideStats?pageSize=400`, { headers: H });
const j = await r.json();
if (!r.ok) { console.error(j.error?.message); process.exit(1); }
const docs = (j.documents || [])
  .map(d => ({ day: d.name.split('/').pop(), f: d.fields || {} }))
  .sort((a, b) => a.day.localeCompare(b.day))
  .slice(-DAYS);

if (!docs.length) { console.log(`\nNo guide traffic recorded yet on ${PID}.\n`); process.exit(0); }

console.log(`\n  GUIDE TRAFFIC — ${PID}\n`);
console.log('  date          views   started    done   completion');
console.log('  ' + '─'.repeat(52));
let V = 0, S = 0, D = 0;
for (const d of docs) {
  const v = n(d.f.views), s = n(d.f.quizStarted), c = n(d.f.quizDone);
  V += v; S += s; D += c;
  const pct = v ? Math.round((c / v) * 100) + '%' : '—';
  console.log(`  ${d.day}   ${String(v).padStart(5)}   ${String(s).padStart(7)}   ${String(c).padStart(5)}   ${pct.padStart(10)}`);
}
console.log('  ' + '─'.repeat(52));
console.log(`  TOTAL         ${String(V).padStart(5)}   ${String(S).padStart(7)}   ${String(D).padStart(5)}   ${(V ? Math.round(D / V * 100) + '%' : '—').padStart(10)}`);

// Per-question accuracy across the whole window.
const Q = {};
for (const d of docs) for (const k of Object.keys(d.f)) {
  const m = k.match(/^q(\d+)_(ok|no)$/); if (!m) continue;
  const q = Q[m[1]] || (Q[m[1]] = { ok: 0, no: 0 });
  q[m[2]] += n(d.f[k]);
}
const qs = Object.keys(Q).sort((a, b) => a - b);
if (qs.length) {
  console.log('\n  WHICH RULES PEOPLE GET WRONG\n');
  console.log('  question   answered   correct   rate');
  console.log('  ' + '─'.repeat(44));
  const rows = qs.map(k => { const t = Q[k].ok + Q[k].no; return { k, t, ok: Q[k].ok, pct: t ? Q[k].ok / t : 1 }; });
  for (const r of rows)
    console.log(`  Q${r.k.padEnd(8)} ${String(r.t).padStart(8)}  ${String(r.ok).padStart(8)}   ${(Math.round(r.pct * 100) + '%').padStart(5)}`);
  const worst = rows.filter(r => r.t >= 5).sort((a, b) => a.pct - b.pct)[0];
  if (worst && worst.pct < 0.6)
    console.log(`\n  ⚠  Q${worst.k} is being missed by ${100 - Math.round(worst.pct * 100)}% of people.`+
                `\n     That usually means the RULE is unclear, not the reader.`);
}

// Score spread.
const sc = {};
for (const d of docs) for (const k of Object.keys(d.f)) {
  const m = k.match(/^sc(\d+)$/); if (m) sc[m[1]] = (sc[m[1]] || 0) + n(d.f[k]);
}
const keys = Object.keys(sc).sort((a, b) => a - b);
if (keys.length) {
  console.log('\n  SCORES\n');
  const max = Math.max(...keys.map(k => sc[k]));
  for (const k of keys)
    console.log(`  ${String(k).padStart(2)}/9  ${'█'.repeat(Math.round((sc[k] / max) * 26)) || '▏'} ${sc[k]}`);
}
console.log('');
