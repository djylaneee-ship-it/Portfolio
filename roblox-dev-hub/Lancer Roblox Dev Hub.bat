@echo off
title Roblox Dev Hub
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js est introuvable. Installe-le depuis https://nodejs.org puis relance. & pause & exit /b)
start "" /min cmd /c "timeout /t 2 >nul & start http://localhost:4747"
node server.js
pause
