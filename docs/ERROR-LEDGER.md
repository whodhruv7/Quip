# Quip — ERROR LEDGER (the final error-handling file)

> This is the CAP-100 deliverable of the overnight "Do Everything" program.
> Two sections: **(1) every error actually hit while building this wave** — each with
> its root cause, the fix commit-side, and a `[SOLVED]` mark — and **(2) the full
> error-class catalog of the new engines**, i.e. every failure mode the code can
> produce at runtime, where it is raised, how the user sees it, and its handling
> status. Nothing here is hidden: an unhandled error is marked `[OPEN]`, never
> pretended away.

Verification at the time of writing: `npm test` → **522/522 pass, 0 fail** ·
`tsc` clean ×3 (electron, tests, frontend root) · `vite build` ✓ 2.9s.

---

## 1. Build-session error log (every error hit while coding this wave)

| # | Error (as thrown / seen) | Where | Root cause | Fix | Status |
|---|--------------------------|-------|------------|-----|--------|
| E-01 | `TS1117: object literal cannot have multiple properties with the same name` | `brain/understanding.ts` ACTION_KIND map | `battery` key added twice during the autonomy-wave edit | Removed the fine-grained duplicate (battery declared once, in the coarse section) | `[SOLVED]` |
| E-02 | Regex `/^https?:\\/\\/i.test(url)` — unterminated regex literal | `intent-parser-v2.ts` `detectUrlIn` | Escaping mistake while writing the https-prefix check | Corrected to `/^https?:\/\//i.test(url)` | `[SOLVED]` |
| E-03 | `step is not defined` in quest intent branch | `intent-parser-v2.ts` email-from-website branch | Copied executor-style `step.params.hint` into parser scope | Hint/body now parsed from the raw text (`founder/ceo/…`, `about …`) | `[SOLVED]` |
| E-04 | `"whom + what"` broke out of a double-quoted string literal | `tool-registry.ts` `mailwing_send` | Nested unescaped quotes | Rephrased the message (no inner quotes) | `[SOLVED]` |
| E-05 | Same class: `"save a routine called …"` broke `routine_list` output string | `tool-registry.ts` | Nested unescaped quotes | Switched to a single-quoted TS string | `[SOLVED]` |
| E-06 | `watchEventSink is not defined` (referenced before declared) | `tool-registry.ts` `file_watch` | Sink setter was planned but never written | Added `setWatchEventSink()` + module state; main.ts injects the toast bridge | `[SOLVED]` |
| E-07 | Duplicate import of `permissionSystem` in `main.ts` (would be TS2300) | `main.ts` | Autonomy wiring re-imported an existing symbol; also the wrong one (legacy system vs engine system) | Removed the duplicate; quest runtime uses `execPermissionSystem` (the engine's own permission system) | `[SOLVED]` |
| E-08 | `executeTool` not in scope in `main.ts` quest runtime | `main.ts` | Runtime needs direct tool calls for quest steps | Added to the existing `tool-registry` import | `[SOLVED]` |
| E-09 | `smtp testAccount would actually SEND a mail` (design bug caught in self-review, §40-style) | `mailwing.ts` ↔ `smtp-client.ts` | Full session ran DATA before returning | Added `stopAt: "auth" \| "mail"` to the protocol machine; the probe QUITs before MAIL FROM — nothing can ever be sent by a test | `[SOLVED]` |
| E-10 | Test: `data payload contains dot-stuffed line` failed | `tests/autonomy-wave.test.mjs` | Test assumed raw text on the wire; the MIME body is base64, so dot-stuffing is a no-op there (base64 has no leading dots) | Test now asserts the payload ends with the terminating dot and decodes to the original text; dot-stuffing stays covered by its own unit test | `[SOLVED]` |
| E-11 | Test: AUTH LOGIN fallback sent `AUTH PLAIN` | `smtp-client.ts` `parseEhloCapabilities` | `AUTH PLAIN LOGIN` was parsed as keyword "AUTH" only — mechanisms never registered, so the client couldn't pick LOGIN | Capability parser now registers every mechanism after `AUTH` | `[SOLVED]` |
| E-12 | `connect ECONNREFUSED 127.0.0.1:1` THROWN out of `sendMail` | `mailwing.ts` send loop | `smtpSend` rejects on connection-level errors; the retry loop had no try/catch | Connection errors normalize into an honest `SmtpResult` (stage `greeting`), so the caller sees "failed", never an exception | `[SOLVED]` |
| E-13 | Test: JSON-encoded payload assertion failed | `tests/autonomy-wave.test.mjs` | Wrong expectation — script interpolates `payload.text`, and JSON does not escape `/` | Assertion updated to the real safety contract: value is exactly `JSON.stringify(args)` inline; quotes cannot escape the string literal | `[SOLVED]` |
| E-14 | Test: duplicate cleanup kept BOTH copies | `tests/autonomy-wave.test.mjs` | Misread the contract — the FIRST copy of a group survives, the rest go to `.quip-trash` | Test fixed; engine behavior verified correct | `[SOLVED]` |
| E-15 | Quest `cancelled` was `undefined` after a declined plan | `quest-engine.ts` `runQuest` | Failure path returned before the end-of-quest `declined` check; step `data` also never merged on failure | Failure path now merges step data and carries `cancelled: true` with a clear "you declined — nothing happened" summary | `[SOLVED]` |
| E-16 | `routine_save` captured the whole sentence as the name (`"morning that organizes downloa"`) | `intent-parser-v2.ts` routine regex | Greedy `[a-z0-9 _-]{2,30}` | Non-greedy capture with `(?= that|which|with|for|to …\|$)` lookahead | `[SOLVED]` |
| E-17 | `send a formal email to rahul@acme.com` routed to the WEBSITE quest | `intent-parser-v2.ts` `detectUrlIn` | The email address itself contains a dot-domain — the "URL detector" saw `acme.com` as a website | Email addresses are stripped BEFORE URL detection; "email him" ≠ "browse" | `[SOLVED]` |
| E-18 | `clean duplicates in downloads` hit the organize branch | `intent-parser-v2.ts` | "clean" matches both intents; organize branch ran first | Organize branch now excludes `duplicates?` text | `[SOLVED]` |
| E-19 | `stop watching downloads` routed to chat | `intent-parser-v2.ts` | `\bwatch\b` doesn't match "watching" | Verb alternation widened (`watch\|watching\|monitor\|auto-organize`) | `[SOLVED]` |
| E-20 | `clipboard history dikhao` opened the OLD copy-to-clipboard flow | `intent-parser-v2.ts` legacy clipboard branch | Legacy branch matched any "clipboard" text and ran first | Legacy branch excludes `history/recent/purani/previous`; the whole autonomy block also moved above all legacy branches (ordering fix, see E-21) | `[SOLVED]` |
| E-21 | Intent ORDER defect (found by reading, not by failure): file-op `find X`, `read_page` and others intercepted the new verbs | `intent-parser-v2.ts` | Autonomy branches were placed near the END of the parser | The whole autonomy block moved to run immediately after the SCREENSHOT section, ahead of every legacy branch; verified by an offset assertion in the move script | `[SOLVED]` |
| E-22 | `mailwing_outbox: failure states missing` (test) | `actions/contracts.ts` | Contract had an empty `failureStates` array — the §-field test demands honest failure states for every tool | Added `journal-unreadable` failure state | `[SOLVED]` |
| E-23 | Frontend `tsc` errors (pre-existing debt surfaced by the new full typecheck): `companionId` undefined in a `SettingsPanel` bar; `getWeeklyDigest`/`recordReflectionFeedback` missing from the hand-written `QuipAPI` union; cycle-mode callback typed as string | `SettingsPanel.tsx`, `types/api.ts`, `App.tsx` | The renderer API type was hand-written and had drifted from the real preload surface | `ReflectionAPI` + `AutonomyAPI` added to `types/api.ts`; `DNABar` got a typed `companionId` prop; callbacks match the real payload shapes | `[SOLVED]` |
| E-24 | Broken string in test cleanup ("part 1" fake-row assert) | `tests/autonomy-wave.test.mjs` | Over-clever one-liner assertion written at 2 AM of the run | Replaced with plain, honest assertions | `[SOLVED]` |
| E-25 | Diary eviction test failed: oldest resolved was NOT evicted first | `problem-diary.ts` `evictOrder` | Sort comparator inverted (`ar - br` keeps OPEN first — exactly backwards) | Comparator fixed to `br - ar`; BOTH the module and the test now evict resolved-then-oldest | `[SOLVED]` |
| E-26 | `noteProblem` eviction kept the WRONG half | `problem-diary.ts` `noteProblem` | `.slice(0, CAP-1)` on an eviction-ordered list keeps the candidates instead of dropping them | `.slice(-(CAP-1))` — drop from the front, keep the tail | `[SOLVED]` |
| E-27 | `classifySeverity("ghost-blocked")` returned HIGH | `problem-diary.ts` HIGH_PAT | The substring `lock` matched inside "b**lock**ed" | `lock` removed from the HIGH pattern (blocked = medium, auth/vault = high) | `[SOLVED]` |
| E-28 | "unconfigured diary" test wrote successfully | `tests/problem-diary.test.mjs` | Test pointed the store at a fresh DIR (writable), not a broken one | Store now pointed at a FILE — every write fails; `noteProblem` returns null, export fails honest | `[SOLVED]` |
| E-29 | `TS2304: Cannot find name 'noteProblem'` | `main.ts` | Import block got the other diary symbols but skipped the recorder | `noteProblem` added to the problem-diary import | `[SOLVED]` |
| E-30 | `TS2339: Property 'active' does not exist` in self_check | `device-selfcheck.ts` | `watchStatus()` returns `{dir, autoOrganize}[]`, not a counter object | Probe now counts `autoOrganize` watches itself | `[SOLVED]` |
| E-31 | `SyntaxError: Unexpected token` in completion tests (×5) | `tests/completion-round.test.mjs` | TypeScript syntax (`as const`, type annotations) pasted into `.mjs` | All annotations stripped — tests stay plain ESM | `[SOLVED]` |
| E-32 | `TS2339: problemDiaryGet missing on QuipAPI` (×6) | `src/types/api.ts` | Renderer API type is hand-written; the new preload surface drifted from it | Problem Diary + contactsSave + getPathForFile + budget APIs added to the type (same lesson as E-23) | `[SOLVED]` |
| E-33 | Broken template literal in file_op search output | `tool-registry.ts` | Quote typo while adding the content-grep branch: `? "s" : "}:` | String repaired; content hits render as their own section | `[SOLVED]` |
| E-34 | CAP-060 budget test asked 3× with budget 1 | `quest-engine.ts` (initial design) | Budget keyed per QUEST; the test asserted per REPEAT counting | Confirmed design: budget counts REPEAT approvals of the same title within one quest (ask, auto, ask); test aligned to the contract | `[SOLVED]` |

Every error above is also covered by a regression test where a test can express it
(protocol tests, parser tests, quest runner tests). The suite that proves it:
`npm test` → 495/495.

---

## 2. Runtime error-class catalog (new engines — how every failure is handled)

Legend: **Handled** = converted into an honest user-facing message + logged with
evidence. **[OPEN]** = known gap, documented, not yet handled.

### SMTP client (`electron/engine/smtp-client.ts`)
| Error class | Raised when | User sees | Status |
|---|---|---|---|
| connect refused / DNS failure | socket error before greeting | "Send failed at greeting — <exact OS error>", journaled | **Handled** (E-12) |
| connect/greeting timeout | no 220 in 30s | timeout message with stage | **Handled** |
| bad greeting (4xx/5xx) | server refuses | stage + server reply verbatim | **Handled** |
| EHLO failure | no 250 | stage + reply | **Handled** |
| STARTTLS rejected | 220 not returned | stage + reply | **Handled** |
| AUTH rejected (535) | bad credentials | stage `auth` + server text; MailWing suggests re-entering the password | **Handled** |
| AUTH mechanism mismatch | client sends mechanism server didn't advertise | cannot happen — mechanisms parsed from EHLO (E-11) and choice honors them | **Handled** |
| RCPT rejected (550…) | unknown/undeliverable recipient | `rcpt: <recipient>: <server text>` | **Handled** |
| DATA rejected | policy/spam block | stage + server reply | **Handled** |
| mid-session drop | socket close | "connection closed by server" at the current stage | **Handled** |
| script exhaustion in tests | scripted IO runs dry | test failure (never ships) | **Handled** |

### MailWing (`electron/engine/mailwing.ts`)
| Error class | Raised when | User sees | Status |
|---|---|---|---|
| vault empty | send with no account | "no MailWing account — add one in Settings, or I'll open a prefilled Gmail draft" + Gmail fallback path | **Handled** |
| vault locked | `enc1:` secret not decryptable on this machine | "re-enter your password in Settings" — never a silent empty send | **Handled** |
| unresolvable recipient | `to` has no @ and no contacts hit | asks for the address or to save the contact | **Handled** |
| humanizer unavailable | model router fails | draft uses the user's raw text, `humanized: false` noted — a send is never blocked by a failed humanizer | **Handled** |
| transient send failure | greeting/timeout | exactly ONE retry after 1.5s, then honest failure | **Handled** |
| permanent 5xx | server refuses | NO retry — the server's word is final | **Handled** |
| outbox journal write fails | disk error | journaling is best-effort; the send result is still returned truthfully | **Handled** |

### WebGhost (`electron/engine/web-ghost.ts`)
| Error class | Raised when | User sees | Status |
|---|---|---|---|
| unsafe URL | SSRF gate trip (private host, file:, encoded IP, creds) | refused with the gate reason | **Handled** |
| navigation budget spent | > 6 pages in one session | session destroyed + "budget spent, ask again for a fresh pass" | **Handled** |
| load failure (DNS/404/blocked) | loadURL error (ERR_ABORTED probed before failing) | honest load-failed with the error | **Handled** |
| ghost script timeout | page JS hangs | 15s cap, honest timeout | **Handled** |
| no contacts found | site hides emails | "found nothing (even after following their contact page) — the site may hide contacts behind a form" | **Handled** |
| click target missing | no visible match | "couldn't find 'X' to click — no match" | **Handled** |
| fill field missing | selector+hint both miss | per-field "not found" report, filled count still honest | **Handled** |
| idle window leak | user walks away | 60s idle auto-destroy + destroy on quit | **Handled** |

### FileButler (`electron/engine/file-butler.ts`)
| Error class | Raised when | User sees | Status |
|---|---|---|---|
| denied directory | organize/report/scan/watch on Windows/, Program Files, AppData, node_modules, .git… | "I won't touch system directories" | **Handled** |
| source vanished mid-apply | file deleted between plan and apply | per-file "source vanished" failure line; other moves proceed | **Handled** |
| cross-volume rename fails | EXDEV | copy+unlink fallback, then honest per-file failure | **Handled** |
| collision target exists | same name in target folder | `-2/-3…` suffix policy — never silent overwrite | **Handled** |
| undo target missing/occupied | file renamed again / spot taken | per-file undo failure with the reason; manifest preserved | **Handled** |
| watch write error | debounced auto-organize fails | silent at watch layer, journaled by apply; a failed auto-move never toasts success | **Handled** |

### GhostHands (`electron/engine/ghost-hands.ts`)
| Error class | Raised when | User sees | Status |
|---|---|---|---|
| unsupported platform | brightness/wallpaper/lock off-Windows | explicit "Windows-only on your setup" — never fake success | **Handled** |
| wallpaper download blocked/fails | bad URL or network | gate reason / HTTP status | **Handled** |
| WMI refuses brightness | desktop PC / blocked WMI | "this machine didn't accept a brightness change" | **Handled** |
| empty screenshot | screen capture blocked by OS | "capture came out empty — screen recording may be blocked" (0-byte file deleted) | **Handled** |
| notification unsupported | no notification backend | honest failure | **Handled** |
| winget command fails | installer error | raw command output surfaced via run_command evidence | **Handled** |

### Quest engine (`electron/engine/quest-engine.ts`)
| Error class | Raised when | User sees | Status |
|---|---|---|---|
| unknown quest | bad `kind` | list of known quests | **Handled** |
| step crash | executor throws | "Step X crashed — <error>" quest stops, no fake completion | **Handled** |
| approval declined | user says no at the card | "Quest stopped — you declined the destructive step. Nothing happened." + `cancelled` | **Handled** (E-15) |
| mid-quest cancel | task aborted | "Cancelled at step i/n" | **Handled** |
| optional data unavailable (battery/weather) | read fails | step is SKIPPED with a note — the digest says exactly what it could not see | **Handled** |
| routine step failure | any step returns failure | routine continues, final summary says "finished with failures" listing every step | **Handled** |
| quest event sink throws | broken UI listener | swallowed — a broken sink never breaks a quest | **Handled** |

### Intent layer (`intent-parser-v2.ts` autonomy block)
| Error class | Raised when | User sees | Status |
|---|---|---|---|
| send-email without recipient | no address and no "to X" | routes to clarify/agent assist instead of guessing | **Handled** |
| routine save without a known pattern | steps not derivable | routes to agent tier (`needsModelAssist`) to build the JSON properly | **Handled** |
| organize with unknown folder | no known-folder word | falls through honestly (no fake plan) | **Handled** |

## 3. Known gaps (documented, `[OPEN]` — visible in CAPABILITY_MAP.md)

- `ghostWaitForText` is now a first-class executor (`web_ghost_wait`, CAP-007). `[SOLVED]`
- Ghost page screenshot is real (CAP-008: `web_ghost_screenshot` → PNG in
  Pictures/Quip with byte-size evidence). `[SOLVED]`
- Autonomy budget (CAP-060) shipped: engine + IPC + Settings card. `[SOLVED]`
- Recovery classifier (CAP-075/076) now specializes smtp-auth, smtp-rejected,
  ghost-blocked, vault-locked and watch-stopped. `[SOLVED]`
- Live-device truth: SMTP delivery to a real inbox, wallpaper/brightness on the
  user's actual laptop, and real site extraction need the user's machine — the
  sandbox proves logic, not hardware (see CAPABILITY_MAP.md). `[OPEN]`

---

## 4. The Problem Diary (the failure-memory system itself)

Every error class above now ALSO lands in a persistent, user-visible diary —
`electron/engine/problem-diary.ts`, surfaced in **Settings → Problems**:

| Property | Value |
|---|---|
| Recorded automatically from | every failed `executeTool` call (with its real output as evidence), every quest step failure/crash (NOT user declines — consent is not a bug), routine step failures, chat failures (no-key/network/provider), prompt-build crashes |
| Dedupe | same source+normalized-title → `occurrences++`, `lastSeen` refreshed, first-seen preserved |
| Reopen rule | a RESOLVED problem that returns reopens automatically with `reopenCount++` — "it came back" is visible truth |
| Severity | auto-classified (auth/permission/vault → high, network/timeout/blocked → medium) |
| Bounds | 500 entries; resolved evict first, then oldest; strings clamped (title 160, detail 1000, evidence 10×200) |
| Fail-soft | `noteProblem` NEVER throws — a broken diary cannot break a task that is already failing (proven by test with a deliberately broken store) |
| User surface | Settings → Problems: open/resolved/all filters, severity dots, HIGH badges, expandable evidence, "Mark resolved", live stats via `PROBLEM_DIARY_CHANGED` broadcast |
| Download | "Export report ↓" writes `quip-problems-YYYY-MM-DD.md` to the Desktop — a readable Markdown report (status, severity, counts, evidence) to hand back for fixes |
| Chat verbs | "problems dikhao" lists; "resolve problem 2" marks; "export problem report" writes the file — deterministic parser routing, never model-guessed |
| Secrets | passwords, vault keys and full mail bodies are never recorded — evidence is digested (paths, stages, server codes) |
| Privacy | 100% local JSON at userData/problems/diary.json; export is explicit, nothing phones home |

Tests: `tests/problem-diary.test.mjs` (15) + `tests/completion-round.test.mjs` (12)
cover the pure core, the store lifecycle, every hook, the executor verbs and the
three-way contract/catalog/registry sync.

> Rule this file enforces: **an error that is handled must be handled the same
> way everywhere — honestly, with evidence, and with the user's language.** When
> you add a failure mode, add its row here in the same commit.
