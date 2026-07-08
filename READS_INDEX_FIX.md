# Logs Query Read Volume — Index State & Fix Proposal
_Investigated 2 July 2026. Index state verified via `firebase firestore:indexes` CLI against both live projects — not assumed. No changes made; this is a proposal._

---

## 1. Verified index state

```
firebase firestore:indexes --project forge-25c8c        → { "indexes": [], "fieldOverrides": [] }
firebase firestore:indexes --project forge-staging-865ff → { "indexes": [], "fieldOverrides": [] }
```

**There are zero composite indexes on either project.** No index on `(groupCode, month, year)` exists in any field order. There is also no `firestore.indexes.json` / `firebase.json` in the repo — indexes have never been managed at all.

## 2. Correcting the root-cause model (this matters for what the fix buys)

Two premises in the analysis need adjusting, because they change which fix actually saves reads:

**a) The missing composite index is not causing a billed collection scan.** The query (`groupCode==X, month==Y, year==Z`) is *equality-only*. Firestore serves equality-only queries by zipper-merging the automatic single-field indexes — no composite index is *required*, which is why the app works at all. When a composite index is genuinely required and missing, Firestore doesn't fall back to scanning; it rejects the query with a `failed-precondition` error and a create-index link. The app gets no such errors.

**b) Billed reads = documents returned, not documents scanned.** The "217 scanned to return ~100" figure is the shape of a Query Explain / query-insights stat: with a zipper merge across three single-field indexes, Firestore over-scans **index entries** (every `month==6` entry across all groups, every `year==2026` entry across everything, intersected). Index-entry scanning costs latency and backend work — it is **not billed as document reads**. The ~217 documents billed per execution is more simply explained as the honest size of the result set: BR0RRU has ~16 players × ~14 logged days by late June ≈ 220 log docs in the month. The listener reads all of them on every (re)establishment.

**c) The code is NOT double-subscribing.** Verified: `subscribe()` (index.html:903) is called only from `launchApp()` (:840), which runs once per app open / group switch / rollover — and its first act is tearing down all prior listeners (`unsub.forEach`). `refresh()` is the snapshot *callback*, not a subscriber. One live logs listener per session. So hypothesis (b) from the analysis — duplicate subscriptions — is ruled out. The "3 executions" are simply 3 app opens/reloads in the monitoring window.

**The real cost mechanic:** every app open re-establishes the listener, and a fresh listener's initial snapshot bills the *entire* result set — the full month of the group's logs. That set grows linearly through the month (~7× bigger on day 28 than day 4). This is a habit app people open daily on phones (PWA reloads are frequent), so the dominant read pattern is *full-month re-reads on every open*, multiplied by users × opens/day.

## 3. Answer: (c) — but the code half is persistence, not query changes

### Fix A — create the composite index (do it, but for latency, not reads)
Create on **both projects**:

- Collection: `logs`, scope: Collection
- Fields, in order: `groupCode` ASC, `month` ASC, `year` ASC

This collapses the three-way zipper merge into a single contiguous index range — the 217-scanned-per-100-returned inefficiency disappears, queries get faster and cheaper for Firestore's backend. **Read-billing reduction: zero.** Set it up properly this time: add `firebase.json` + `firestore.indexes.json` to the repo so index state is version-controlled, and deploy with `firebase deploy --only firestore:indexes --project <id>`. (Bonus: the same index serves the `bonuses_30day`/`flags`/`bonuses_iron_pledge` query shape if their volumes ever matter — same three fields; add those collections to the index file while you're there, or leave until needed.)

### Fix B — enable Firestore offline persistence (this is where the reads go away)
One call in `src/config/firebase.js`, immediately after `const db = firebase.firestore()` and **before any other Firestore usage**: enable IndexedDB persistence (compat API `db.enablePersistence({synchronizeTabs:true})`, with a caught rejection so unsupported browsers just fall through to today's behavior).

Why this is the lever: with a persisted local cache and its resume token, a re-established listener doesn't re-read the whole result set — the backend sends **only documents changed since the last sync**, and only those are billed. Without persistence, every app open after >30 minutes is a full re-read; with it, a returning device pays roughly "new logs since last open" (a handful) instead of "the whole month" (hundreds).

Caveats to accept knowingly:
- Multi-tab needs `synchronizeTabs:true` or the second tab's persistence call rejects (the catch handles it — that tab just runs cache-less).
- iOS Safari *browser* tabs can evict IndexedDB after 7 days of site inactivity; the installed PWA (your main usage) is much stickier. Worst case on eviction = one full re-read, i.e., today's behavior.
- Very stale resume tokens can force a full re-sync — again, worst case is the status quo.
- UX side effect is positive: instant cached paint on open, live data replaces it.

## 4. Realistic read reduction

Using the measured window (3 executions, 655 reads/day on this query):

| Scenario | This query's reads/day | Notes |
|---|---|---|
| Today | ~655 | full month re-read × 3 opens |
| Index only (Fix A) | **~655 (no change)** | latency/backend win only — the "3×217 → 3×1" arithmetic doesn't apply to Firestore billing |
| Persistence (Fix B) | **~230 first day, then ~30–80/day** | first open per device still syncs the full set once; thereafter each open bills only new/changed logs (~16–30 new logs/group/day, split across opens) |

**Net on this query: roughly 85–90% reduction in steady state**, and the savings *grow* through the month (full re-reads scale with month progress; deltas don't).

The forward-looking number is the one that matters more: at ~56 users × ~2 opens/day × ~200 docs late-month, today's pattern is heading for **~22k reads/day (≈45% of free quota) from this one listener** — consistent with AUDIT.md finding #6's trajectory warning. Persistence caps that at roughly the daily log-creation volume × a small multiple: **~2–4k/day at the same scale (~5–8% of quota)**.

## 5. Recommended sequence

1. **Fix B first** (one guarded line in firebase.js, staging → verify → prod; bump SW cache version on promote). It's the entire read savings. Test on staging: open app, note reads; close, log one workout from a second device, reopen — confirm the console Network tab shows a delta listen, not a full result set; verify two-tabs-open works and a private-window (no IndexedDB) session still functions.
2. **Fix A second** (index deploy + commit `firestore.indexes.json` to the repo, both projects). Zero risk, no code interaction, no cache bump needed.
3. These are orthogonal — no ordering dependency between them; B-first purely because it carries all the value.

Neither fix changes `firestore.rules`, the query shape, or any scoring/data behavior.
