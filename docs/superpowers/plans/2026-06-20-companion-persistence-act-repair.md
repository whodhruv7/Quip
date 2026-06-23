# Companion Persistence and Act Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Quip's companion visible in the same window even when the chat section is closed, restore tap-to-open behavior, and make act mode reliably execute again.

**Architecture:** Keep the existing single Electron window, but decouple companion visibility from chat visibility. The window should render the companion as a persistent layer and treat chat as a toggleable panel rather than the thing that owns the whole surface. Act mode should stay local and deterministic: intent parsing, capability resolution, and execution must be wired end-to-end, with explicit fallbacks and visible errors when a device capability is missing.

**Tech Stack:** Electron, React 18, Vite, TypeScript, existing IPC bridge, existing task brain/capability registry/tool executor.

---

### Task 1: Stop Chat Close From Hiding the Companion

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/ScanOverlay.tsx`

- [ ] **Step 1: Write the failing behavior note**

```ts
// Expected behavior:
// - Clicking the chat close/hide control must hide only the chat panel.
// - The companion must remain visible in the same Electron window.
// - Tapping the companion must reopen the chat panel.
```

- [ ] **Step 2: Implement the shell separation**

```tsx
// In App.tsx:
// - Keep a separate `chatOpen` state.
// - Render the companion unconditionally.
// - Render the chat panel conditionally based on `chatOpen`.
// - Do not hide the whole window when chat closes.
```

- [ ] **Step 3: Reopen chat from companion tap**

```tsx
// On companion click:
// - setChatOpen(true)
// - do not toggle companion visibility
// - preserve drag behavior
```

- [ ] **Step 4: Remove splash lockups**

```tsx
// In ScanOverlay:
// - Keep the existing bootstrap progress listener.
// - Add a fallback timeout that closes the overlay even if progress events do not arrive.
// - Ensure the overlay cannot permanently block the companion.
```

- [ ] **Step 5: Verify the companion remains visible**

Run:

```bat
cd /d C:\Users\jce\ZCodeProject\Quip
npm run build
npm run launch
```

Expected: the companion remains visible after chat is closed, and tapping the companion reopens chat.

### Task 2: Make Act Mode Execute End-to-End Again

**Files:**
- Modify: `electron/main.ts`
- Modify: `electron/brains/task-brain.ts`
- Modify: `electron/brains/capability-registry.ts`
- Modify: `electron/brains/tool-executor.ts`
- Modify: `src/hooks/useChat.ts`
- Modify: `electron/shared.ts`

- [ ] **Step 1: Confirm the task pipeline shape**

```ts
// Expected pipeline:
// renderer -> IPC TASK_EXECUTE -> parseIntent -> buildPlan -> resolveCapability -> executeImplementation -> result back to renderer
```

- [ ] **Step 2: Make task failures visible**

```ts
// When a task cannot resolve a capability:
// - return a task result with a clear summary
// - include notes that explain which capability was missing
// - do not silently fall through without user feedback
```

- [ ] **Step 3: Keep chat fallback separate**

```ts
// In useChat:
// - if executeTask returns a real action result, show it
// - if the task is chat-only, stream to the model as before
// - keep the request id handling consistent so action and chat flows do not collide
```

- [ ] **Step 4: Make browser-based actions resolve to the right app**

```ts
// In capability-registry:
// - resolve openUrl/openBrowser/playMedia through the detected default browser
// - if the browser scan is incomplete, fall back to OS default URL handling
// - never assume Chrome-only behavior
```

- [ ] **Step 5: Verify common commands**

Run:

```bat
cd /d C:\Users\jce\ZCodeProject\Quip
npm run build
npm run launch
```

Then test:

```text
open youtube
play arijit singh
open gmail and write a mail
```

Expected: Quip performs an action, shows a visible note, or explains the missing capability instead of doing nothing.

### Task 3: Package a Repeatable Launch Path and Release Zip

**Files:**
- Modify: `run-quip.cmd`
- Modify: `install-desktop-trigger.cmd`
- Modify: `install-desktop-trigger.ps1`
- Create: `Quip-source.zip` at repository root

- [ ] **Step 1: Make the launcher deterministic**

```bat
@echo off
setlocal
cd /d "%~dp0"
npm run build
start "" cmd /c npm run launch
exit /b 0
```

- [ ] **Step 2: Keep the desktop shortcut installer simple**

```powershell
$ErrorActionPreference = "Stop"
$repoRoot = $PSScriptRoot
$desktop = [Environment]::GetFolderPath("Desktop")
$target = Join-Path $repoRoot "run-quip.cmd"
$shortcutPath = Join-Path $desktop "Quip.lnk"

if (-not (Test-Path $target)) { throw "Missing launcher: $target" }

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $repoRoot
$shortcut.WindowStyle = 1
$shortcut.Description = "Launch Quip"
$shortcut.Save()
```

- [ ] **Step 3: Rebuild the zip**

Run:

```powershell
Compress-Archive -Path `
  C:\Users\jce\ZCodeProject\Quip\electron,`
  C:\Users\jce\ZCodeProject\Quip\src,`
  C:\Users\jce\ZCodeProject\Quip\index.html,`
  C:\Users\jce\ZCodeProject\Quip\package.json,`
  C:\Users\jce\ZCodeProject\Quip\package-lock.json,`
  C:\Users\jce\ZCodeProject\Quip\tsconfig.json,`
  C:\Users\jce\ZCodeProject\Quip\vite.config.ts,`
  C:\Users\jce\ZCodeProject\Quip\tailwind.config.mjs,`
  C:\Users\jce\ZCodeProject\Quip\postcss.config.mjs,`
  C:\Users\jce\ZCodeProject\Quip\README.md,`
  C:\Users\jce\ZCodeProject\Quip\run-quip.cmd,`
  C:\Users\jce\ZCodeProject\Quip\install-desktop-trigger.cmd,`
  C:\Users\jce\ZCodeProject\Quip\install-desktop-trigger.ps1,`
  C:\Users\jce\ZCodeProject\Quip\.env.example `
  -DestinationPath C:\Users\jce\ZCodeProject\Quip-source.zip -Force
```

- [ ] **Step 4: Final verification**

Run:

```bat
cd /d C:\Users\jce\ZCodeProject\Quip
npm run build
npm run launch
```

Expected:
- companion remains visible after chat close
- tapping companion reopens chat
- act mode executes supported commands
- zip exists at `C:\Users\jce\ZCodeProject\Quip-source.zip`

