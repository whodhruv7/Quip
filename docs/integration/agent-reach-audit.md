# Agent-Reach Audit (for Quip integration)

Source: https://github.com/Panniantong/Agent-Reach — a Python capability layer
(installer + doctor + backend router + skill pack) for 15 internet platforms.
It is NOT a desktop-automation framework; its value for Quip is in its
verification, routing, and safety patterns.

## Useful To Port (and where it landed)

- Module: `probe.py:probe_command` → real-execution probing with
  missing/broken/timeout/error classification
  - Capability: never trust "command didn't throw"; verify observed state
  - Quip destination: `electron/engine/action-verifier.ts` (processExists,
    windowWithTitleExists, verifyLaunched, pollUntil)
  - Adaptation: PowerShell/Node-native probes instead of shutil.which

- Module: `channels/web.py:read` (r.jina.ai reader + antibot detection + caps)
  - Capability: read/understand any public web page
  - Quip destination: `electron/engine/browser-automation.ts` (readWebPage)
  - Adaptation: Node fetch, 20s timeout, HTML-strip fallback chain

- Module: `utils/url.py:normalize_public_http_url` (SSRF guard)
  - Capability: block localhost/private IPs/file:// /credentialed URLs
  - Quip destination: `browser-automation.ts` (isSafePublicUrl)
  - Adaptation: regex host checks for IPv4 ranges + protocol allowlist

- Module: `channels/youtube.py` (yt-dlp backend routing, JS-runtime checks)
  - Capability: YouTube search + metadata + playback intent
  - Quip destination: `browser-automation.ts` (searchYouTubeVideoId,
    playFirstYouTubeResult) — direct scrape + verified /watch URL; opens in
    Quip's focused browser surface
  - Adaptation: no external yt-dlp dependency; native fetch scrape

- Module: doctor `check_all`/`format_report` honesty rules
  - Capability: report what was actually verified vs assumed
  - Quip destination: ActionVerification.evidence carried into ToolResult.note
  - Adaptation: per-action evidence strings shown in the chat trust layer

## Do Not Port

- Separate UI/app bootstrap: Agent-Reach is a CLI/MCP tool — Quip stays the
  single app.
- Upstream CLI installers (opencli, twitter, rdt, bili, mcporter): external
  process dependencies with credential side effects — out of scope.
- Cookie extraction (browser_cookie3/rookiepy): touches stored credentials —
  prohibited for this milestone.
- Docker-based XHS MCP stack: unrelated to Quip's use cases.

## Security Notes

- Permission gates required: sending messages/emails, destructive file ops,
  payments, arbitrary commands → always confirm (permission-modes.ts
  DANGEROUS_ACTIONS).
- Verification required: every open/launch/focus/close returns evidence
  (process running / window title matched / URL loaded). Failures say WHY.
- SSRF guard active on every URL the browser layer touches.
- No credential reading, no arbitrary shell from model output — model picks
  structured actions only.
