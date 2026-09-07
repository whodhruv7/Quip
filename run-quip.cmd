@echo off
setlocal
title Quip Launcher
cd /d "%~dp0"

echo ============================================
echo   QUIP V2  -  Desktop Companion Launcher
echo ============================================
echo.

REM --- Check Node is installed ---
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install from https://nodejs.org
  pause
  exit /b 1
)

REM --- Install deps if missing ---
if not exist "node_modules" (
  echo First run - installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

REM --- Create .env from example if missing ---
if not exist ".env" (
  if exist ".env.example" (
    echo Creating .env from .env.example ^(add your GROQ_API_KEY to it^)...
    copy .env.example .env >nul
  )
)

REM --- Rebuild (compiles new TS changes + bundles renderer) ---
echo.
echo Building Quip ^(this compiles all your latest changes^)...
call npm run build
if errorlevel 1 (
  echo.
  echo [ERROR] Build failed. See errors above.
  pause
  exit /b 1
)

REM --- Launch in production mode ---
echo.
echo Launching Quip... your companion window should appear shortly.
echo ^(Close this window to stop the app^)
echo.

REM Run in foreground so closing this cmd quits the app
cross-env NODE_ENV=production electron .
if errorlevel 1 (
  echo.
  echo [ERROR] Quip crashed. Check the output above.
  pause
)
