// ═══════════════════════════════════════════════════════════════════════════
// FORGE — reset one person's PIN
//
//   node scripts/reset-pin.mjs "Jash Shah"                 # see who it'd hit
//   node scripts/reset-pin.mjs "Jash Shah" --execute       # actually reset
//   node scripts/reset-pin.mjs "Jash Shah" --staging       # test DB instead
//
// DRY RUN BY DEFAULT. Nothing changes without --execute.
//
// WHY THIS EXISTS
// The in-app admin "Reset PIN" button writes pinHash:null straight from a
// browser. That is the same write an attacker uses to take over an account —
// so the deployed rules now make pinHash WRITE-ONCE, and the button correctly
// stops working. This script does the same job with an owner credential, which
// bypasses rules, so a genuine reset stays possible and a hostile one doesn't.
//
// AFTER A RESET the person picks their name on the login screen and is taken
// straight to "Set your PIN" — the normal grace flow. Nothing else about their
// account changes: same identity, same logs, same points, same streak.
// ═══════════════════════════════════════════════════════════════════════════
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

const ARGS    = process.argv.slice(2);
const NAME    = ARGS.filter(a => !a.startsWith('--'))[0];
const EXECUTE = ARGS.includes('--execute');
const STAGING = ARGS.includes('--staging');
const PID     = STAGING ? 'forge-staging-865ff' : 'forge-25c8c';
const ROOT    = `projects/${PID}/databases/(default)/documents`;
const API     = 'https://firestore.googleapis.com/v1';

if (!NAME) {
  console.error('\nUsage: node scripts/reset-pin.mjs "Full Name" [--execute] [--staging]\n');
  process.exit(2);
}

let TOKEN;
try {
  const { stdout } = await run('gcloud', ['auth', 'print-access-token'], { timeout: 20000 });
  TOKEN = stdout.trim();
} catch {
  console.error('Could not get a gcloud token. Run:  gcloud auth login');
  process.exit(1);
}
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const dv = v => { if (v == null) return null;
  if ('nullValue'    in v) return null;   if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('stringValue'  in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue'   in v) return (v.arrayValue.values || []).map(dv);
  if ('mapValue'     in v) return df(v.mapValue.fields || {}); return null; };
const df = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, dv(v)]));

async function list(path) {
  let out = [], tok = null;
  do {
    const u = new URL(`${API}/${ROOT}/${path}`);
    u.searchParams.set('pageSize', '300');
    if (tok) u.searchParams.set('pageToken', tok);
    const r = await fetch(u, { headers: H });
    const j = await r.json();
    if (!r.ok) throw new Error(`${path}: ${j.error?.message || r.status}`);
    (j.documents || []).forEach(d => out.push({ id: d.name.split('/').pop(), data: df(d.fields) }));
    tok = j.nextPageToken || null;
  } while (tok);
  return out;
}

console.log(`\nProject: ${PID}   mode: ${EXECUTE ? 'EXECUTE' : 'DRY RUN'}`);
console.log(`Looking for: "${NAME}"\n`);

// Find every users doc with that name (case-insensitive). Two real people can
// share a name in this app, so we NEVER guess — an ambiguous match stops.
const users = await list('users');
const hits = users.filter(u =>
  String(u.data.name || '').toLowerCase() === NAME.toLowerCase() && !u.data.deletedAt);

if (!hits.length) {
  console.error(`No account found named "${NAME}".`);
  console.error('Names are matched exactly (case doesn\'t matter). Check the spelling in Admin.');
  process.exit(1);
}
if (hits.length > 1) {
  console.error(`${hits.length} accounts share that name — refusing to guess:\n`);
  hits.forEach(h => console.error(`   ${h.id}   groups: ${Object.keys(h.data.memberships || {}).join(', ') || '(none)'}`));
  console.error('\nRe-run with the exact userId instead:  node scripts/reset-pin.mjs --id <userId> --execute');
  process.exit(1);
}

const u = hits[0];
console.log(`  name    : ${u.data.name}`);
console.log(`  userId  : ${u.id}`);
console.log(`  groups  : ${Object.keys(u.data.memberships || {}).join(', ') || '(none)'}`);
console.log(`  has PIN : ${u.data.pinHash ? 'yes' : 'no — already cleared, nothing to do'}`);
console.log(`  Google  : ${u.data.authUid ? 'linked (a PIN reset is pointless — they sign in with Google)' : 'not linked'}`);

if (!u.data.pinHash) { console.log('\nNothing to reset.'); process.exit(0); }

if (!EXECUTE) {
  console.log('\nWould clear pinHash on that one account.');
  console.log('Nothing else changes — logs, points, streak and identity all stay.');
  console.log('\nDRY RUN — nothing was written. Re-run with --execute to apply.\n');
  process.exit(0);
}

// Clear the credential. The roster's pinSet sentinel is cleared too, or the
// login screen would still ask for a PIN that no longer exists.
const r = await fetch(`${API}/${ROOT}/users/${u.id}?updateMask.fieldPaths=pinHash`, {
  method: 'PATCH', headers: H,
  body: JSON.stringify({ fields: { pinHash: { nullValue: null } } })
});
if (!r.ok) { console.error('FAILED:', (await r.json()).error?.message); process.exit(1); }
console.log('\n  ✓ pinHash cleared');

let touched = 0;
for (const code of Object.keys(u.data.memberships || {})) {
  try {
    const g = await (await fetch(`${API}/${ROOT}/groups/${code}`, { headers: H })).json();
    const sid = g.fields?.currentSeasonId?.stringValue;
    if (!sid) continue;
    const sUrl = `${API}/${ROOT}/groups/${code}/seasons/${sid}`;
    const s = await (await fetch(sUrl, { headers: H })).json();
    const roster = dv(s.fields?.roster) || [];
    let changed = false;
    const next = roster.map(p => {
      if (p && p.userId === u.id && p.pinSet) { changed = true; return { ...p, pinSet: false }; }
      return p;
    });
    if (!changed) continue;
    const enc = v => v === null || v === undefined ? { nullValue: null }
      : typeof v === 'boolean' ? { booleanValue: v }
      : typeof v === 'number'  ? { integerValue: String(v) }
      : typeof v === 'string'  ? { stringValue: v }
      : Array.isArray(v)       ? { arrayValue: { values: v.map(enc) } }
      : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
    const w = await fetch(`${sUrl}?updateMask.fieldPaths=roster`, {
      method: 'PATCH', headers: H,
      body: JSON.stringify({ fields: { roster: enc(next) } })
    });
    if (w.ok) { console.log(`  ✓ ${code}: pinSet cleared on the roster`); touched++; }
    else console.error(`  ✗ ${code}: ${(await w.json()).error?.message}`);
  } catch (e) { console.error(`  ✗ ${code}: ${e.message}`); }
}

console.log(`\nDone. ${u.data.name} can now pick their name on the login screen and set a new PIN.`);
console.log(`(${touched} roster${touched === 1 ? '' : 's'} updated.)\n`);
