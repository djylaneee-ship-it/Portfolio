@echo off
title Roblox Dev Hub (mode partage)
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js est introuvable. Installe-le depuis https://nodejs.org puis relance. & pause & exit /b)
echo Le site sera accessible aux appareils de ton reseau. Autorise Node.js si Windows le demande.
set HOST=0.0.0.0
start "" /min cmd /c "timeout /t 2 >nul & start http://localhost:4747"
node server.js
pause
