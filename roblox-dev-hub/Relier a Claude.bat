@echo off
cd /d "%~dp0"
echo Connexion de Roblox Dev Hub a Claude Code...
claude mcp add --scope user roblox-dev-hub -- node "%~dp0mcp.js"
echo.
claude mcp list
echo.
echo Termine ! Lance "claude" et demande-lui de chercher dans ta base Roblox Dev Hub.
pause
