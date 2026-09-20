@echo off
setlocal EnableExtensions
title Quip Launcher
cd /d "%~dp0"

REM ============================================================================
REM Quip launcher — reliable + fast.
REM
 WHY THE APP SOMETIMES "NEVER OPENED":
REM   This file used to (a) install deps ONLY when node_modules was missing, so
REM   after Fetch Updates added a dependency the app broke silently; (b) run a
REM   full build on EVERY launch (30-60s before the companion appeared); and
REM   (c) when launched from the desktop shortcut the console is HIDDEN, so a
REM   failure was completely invisible — the app just "didn't open".
REM
REM HOW IT WORKS NOW:
REM   1. Every step is logged to quip-launch.log (next to this file) — nothing
REM      is ever invisible again.
REM   2. A build stamp (node_modules\.quip-build-stamp) is compared against
REM      package.json / src / electron timestamps. Warm start = a 1-second
REM      check + instant Electron launch. After an update it rebuilds once.
REM   3. On any failure a Windows message box pops up with the real reason —
REM      even from the hidden shortcut launch.
REM ============================================================================

set "QUIP_ROOT=%~dp0"
set "LOG=%QUIP_ROOT%quip-launch.log"
set "STAMP=%QUIP_ROOT%node_modules\.quip-build-stamp"

echo Quip launcher started %DATE% %TIME% > "%LOG%"
echo Root: %QUIP_ROOT% >> "%LOG%"

REM --- 1. Node must exist -----------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found on PATH >> "%LOG%"
  set "QUIP_FAILMSG=Quip could not start: Node.js is not installed on this laptop. Install it from https://nodejs.org (LTS), then double-click Quip again."
  goto :fail
)

REM --- 2. One sync gate: install + build ONLY when something changed ----------
REM Missing stamp = first run (or node_modules was wiped). Newer source or
REM package.json = the user pulled an update -> sync once, then stay fast.
set NEEDSYNC=1
if exist "%STAMP%" (
  powershell -NoProfile -NonInteractive -Command "$s=(Get-Item -LiteralPath $env:QUIP_STAMP -ErrorAction SilentlyContinue).LastWriteTime; if (-not $s) { exit 1 }; $paths=@((Join-Path $env:QUIP_ROOT 'package.json'),(Join-Path $env:QUIP_ROOT 'src'),(Join-Path $env:QUIP_ROOT 'electron')); $new=(Get-ChildItem -LiteralPath $paths -Recurse -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime; if ($new -gt $s) { exit 1 } else { exit 0 }"
  if not errorlevel 1 set NEEDSYNC=0
)

if "%NEEDSYNC%"=="1" (
  echo Syncing dependencies ^(npm install^)... >> "%LOG%"
  call npm install --no-audit --no-fund >> "%LOG%" 2>&1
  if errorlevel 1 (
    echo [ERROR] npm install failed >> "%LOG%"
    set "QUIP_FAILMSG=Quip could not start: installing its dependencies failed. Open quip-launch.log in the Quip folder for the exact reason ^(often: no internet, or npm needs a proxy^)."
    goto :fail
  )

  echo Building Quip ^(compiles updates^)... >> "%LOG%"
  call npm run build >> "%LOG%" 2>&1
  if errorlevel 1 (
    echo [ERROR] Build failed >> "%LOG%"
    set "QUIP_FAILMSG=Quip could not start: the build failed. Open quip-launch.log in the Quip folder — it has the exact error line."
    goto :fail
  )

  > "%STAMP%" echo built %DATE% %TIME%
  echo Sync complete. >> "%LOG%"
) else (
  echo Everything up to date — fast launch. >> "%LOG%"
)

REM --- 3. Launch (production mode, real window) --------------------------------
echo Launching Quip... >> "%LOG%"
call npx cross-env NODE_ENV=production electron . >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [ERROR] Electron exited with an error >> "%LOG%"
  set "QUIP_FAILMSG=Quip stopped unexpectedly. Open quip-launch.log in the Quip folder — the last lines say exactly what happened."
  goto :fail
)

echo Quip closed normally. >> "%LOG%"
endlocal
exit /b 0

:fail
REM The console is usually HIDDEN (desktop shortcut) — make the failure VISIBLE.
powershell -NoProfile -NonInteractive -Command "Add-Type -AssemblyName PresentationFramework; [void][System.Windows.MessageBox]::Show($env:QUIP_FAILMSG, 'Quip', 0, 48)"
endlocal
exit /b 1
