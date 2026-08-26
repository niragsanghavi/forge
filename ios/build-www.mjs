// ═══════════════════════════════════════════════════════════════════════════
// Assemble www/ — the exact web payload that gets BUNDLED into the iOS app.
//
// The repo root IS the website (GitHub Pages serves it), so it also contains
// .git, node_modules, ios/, functions/ and the whole toolchain. Capacitor
// copies webDir wholesale, so pointing it at the root would ship all of that
// inside the app. This script builds a clean tree instead, and is the single
// place that defines "what the app actually contains".
//
// DELIBERATELY EXCLUDED:
//   sw.js, firebase-messaging-sw.js — service workers do not behave the same
//     under Capacitor's capacitor:// scheme, and a half-working SW that caches
//     the shell is worse than none. Offline comes from the native container.
//   about/ — the public landing page. It sells the app to someone who hasn't
//     got it; inside the app it is dead weight.
//   timeline.html, survey/, updates/ — web-only surfaces.
// ═══════════════════════════════════════════════════════════════════════════

import { rm, mkdir, cp, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = join(ROOT, 'www');

// Everything the app needs to boot and run, and nothing else.
const INCLUDE = [
  'index.html',
  'manifest.json',
  // App Store 5.1.1(i): the privacy policy must be reachable inside the app.
  // about/ is excluded below, and that was the web app's only link to it, so
  // without this line the policy is unreachable in the bundle. Shipping the
  // file also means it opens with no network, which a link to goforge.in
  // would not.
  'privacy.html',
  // Onboarding step 1 links "how Forge works" — same reachability rule as the
  // privacy policy: if it's linked from inside the app it must open with no
  // network, from the bundle. Self-contained page; its exits are relative.
  'guide.html',
  'src/style/main.css',
  'src/config/firebase.js',
  'src/state/appState.js',
  'src/services/scoringEngine.js',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

let copied = 0, missing = [];
for (const rel of INCLUDE) {
  const src = join(ROOT, rel);
  if (!existsSync(src)) { missing.push(rel); continue; }
  await mkdir(join(OUT, dirname(rel)), { recursive: true });
  await cp(src, join(OUT, rel));
  copied++;
}

// A missing file here is a broken app, not a warning worth scrolling past.
if (missing.length) {
  console.error('build-www FAILED — missing:', missing.join(', '));
  process.exit(1);
}

const size = async p => (await stat(p)).size;
let total = 0;
for (const rel of INCLUDE) total += await size(join(OUT, rel));
console.log(`www/ built — ${copied} files, ${(total / 1024).toFixed(0)} KB`);
