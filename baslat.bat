@echo off
setlocal
cd /d "%~dp0"

set "NODE_EXE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
    set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
  ) else (
    echo Node.js bulunamadi. Lutfen Node.js LTS kurun: https://nodejs.org
    pause
    exit /b 1
  )
)

echo Lokal — Anonim Sosyal Masa baslatiliyor...
echo Tarayicida acilacak adres: http://localhost:3000
start "" http://localhost:3000
"%NODE_EXE%" server.js
pause
