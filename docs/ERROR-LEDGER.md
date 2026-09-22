# Quip — ERROR LEDGER (the final error-handling file)

> This is the CAP-100 deliverable of the overnight "Do Everything" program.
> Two sections: **(1) every error actually hit while building this wave** — each with
> its root cause, the fix commit-side, and a `[SOLVED]` mark — and **(2) the full
> error-class catalog of the new engines**, i.e. every failure mode the code can
> produce at runtime, where it is raised, how the user sees it, and its handling
> status. Nothing here is hidden: an unhandled error is marked `[OPEN]`, never
> pretended away.

Verification at the time of writing: `npm test` → **495/495 pass, 0 fail** ·
`tsc` clean ×3 (electron, tests, frontend) · `vite build` ✓ 2.8s.

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

## 3. Known gaps (documented, `[OPEN]` — visible in ROADMAP as `[~]`/`[ ]`)

- `ghostWaitForText` exists and is tested but is not yet wired as a standalone
  executor (it runs implicitly between quest steps). `[OPEN]`
- Ghost page screenshot (CAP-008): ghost page capture not implemented; screen
  vision (`screen_observe`) remains the way to see pages. `[OPEN]`
- Autonomy budget counter (CAP-060): quests gate every destructive step through
  approvals today; a per-quest budget knob is future work. `[OPEN]`
- Recovery classifier (CAP-075/076): new failure kinds are named in contracts,
  but `recovery.ts` still uses the generic transient/fatal classification for
  them — behavior is safe (one bounded retry) though not yet specialized. `[OPEN]`
- Live-device truth: SMTP delivery to a real inbox, wallpaper/brightness on the
  user's actual laptop, and real site extraction need the user's machine — the
  sandbox proves logic, not hardware (see CAPABILITY_MAP.md). `[OPEN]`

> Rule this file enforces: **an error that is handled must be handled the same
> way everywhere — honestly, with evidence, and with the user's language.** When
> you add a failure mode, add its row here in the same commit.
