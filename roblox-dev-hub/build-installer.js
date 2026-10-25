// Génère « Installer Rovex Hub.bat » : un seul fichier qui contient toute l'app.
// Usage : node build-installer.js
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, '..', 'Installer Rovex Hub.bat');
const FILES = [
  'db.js', 'mcp.js', 'server.js', 'web.js', 'crawler.js', 'seed.json', 'package.json', 'README.md',
  'public/index.html', 'public/style.css', 'public/app.js', 'public/i18n.js',
  'Lancer Rovex Hub.bat', 'Lancer en mode partage.bat', 'auth.js', 'rovex.ico', 'public/logo.png', 'public/icon.png',
];

const crlf = (s) => s.replace(/\r?\n/g, '\r\n');

const UNINSTALL = crlf(`@echo off
echo Desinstallation de Rovex Hub...
del "%USERPROFILE%\\Desktop\\Rovex Hub.lnk" >nul 2>nul
del "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Rovex Hub.lnk" >nul 2>nul
echo.
echo Tes donnees (data et media) sont gardees dans : %~dp0
echo Supprime ce dossier a la main si tu veux tout effacer.
pause
`);

const payload = FILES.map((f) => {
  const b64 = fs.readFileSync(path.join(ROOT, f)).toString('base64');
  return `  '${f.replace(/\//g, '\\')}' = '${b64}'`;
});
payload.push(`  'Desinstaller.bat' = '${Buffer.from(UNINSTALL).toString('base64')}'`);

const ps = `
$ErrorActionPreference = 'Stop'
$Dir = Join-Path $env:LOCALAPPDATA 'RobloxDevHub'
function Step($t) { Write-Host '' ; Write-Host "  > $t" -ForegroundColor Cyan }
function Ok($t) { Write-Host "    OK  $t" -ForegroundColor Green }
function Warn($t) { Write-Host "    !   $t" -ForegroundColor Yellow }

Write-Host ''
Write-Host '  ==========================================' -ForegroundColor Magenta
Write-Host '     ROVEX HUB  -  Installation' -ForegroundColor Magenta
Write-Host '  ==========================================' -ForegroundColor Magenta

Step 'Verification de Node.js'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Warn 'Node.js est introuvable. Installation via winget...'
  try {
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    $node = Get-Command node -ErrorAction SilentlyContinue
  } catch {}
  if (-not $node) { throw 'Installe Node.js depuis https://nodejs.org (version LTS) puis relance cet installateur.' }
}
$ver = (& node --version)
if ([int]($ver.TrimStart('v').Split('.')[0]) -lt 18) { throw "Node.js $ver est trop ancien : il faut la version 18 ou plus (https://nodejs.org)." }
Ok "Node.js $ver"

Step 'Arret de l''ancienne version'
$old = Get-NetTCPConnection -LocalPort 4747 -State Listen -ErrorAction SilentlyContinue
if ($old) {
  $old | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  Ok 'Ancien serveur arrete'
} else { Ok 'Rien a arreter' }

Step "Copie des fichiers dans $Dir"
$files = @{
${payload.join('\n')}
}
foreach ($k in $files.Keys) {
  $p = Join-Path $Dir $k
  New-Item -ItemType Directory -Force -Path (Split-Path $p) | Out-Null
  [IO.File]::WriteAllBytes($p, [Convert]::FromBase64String($files[$k]))
}
New-Item -ItemType Directory -Force -Path (Join-Path $Dir 'media') | Out-Null
Ok "$($files.Count) fichiers installes (tes donnees existantes sont conservees)"

Step 'Raccourcis Bureau et menu Demarrer'
$launcher = Join-Path $Dir 'Lancer Rovex Hub.bat'
# Nettoyage de l'ancien nom (Roblox Dev Hub)
Remove-Item (Join-Path $Dir 'Lancer Roblox Dev Hub.bat') -ErrorAction SilentlyContinue
Remove-Item (Join-Path $Dir 'Relier a Claude.bat') -ErrorAction SilentlyContinue
$shell = New-Object -ComObject WScript.Shell
$targets = @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'))
foreach ($t in $targets) {
  Remove-Item (Join-Path $t 'Roblox Dev Hub.lnk') -ErrorAction SilentlyContinue
  $lnk = $shell.CreateShortcut((Join-Path $t 'Rovex Hub.lnk'))
  $lnk.TargetPath = $launcher
  $lnk.WorkingDirectory = $Dir
  $lnk.WindowStyle = 7
  $lnk.IconLocation = (Join-Path $Dir 'rovex.ico')
  $lnk.Description = 'Bibliotheque de ressources de dev Roblox'
  $lnk.Save()
}
Ok 'Raccourci "Rovex Hub" cree'

Step 'Serveur MCP'
Ok 'Adresse HTTP  : http://localhost:4747/mcp  (app ouverte)'
Ok ('Commande stdio : node "' + (Join-Path $Dir 'mcp.js') + '"')
Ok 'Tout est aussi affiche dans l''app, page "Serveur MCP".'

Write-Host ''
Write-Host '  Installation terminee ! Lancement de l''app...' -ForegroundColor Green
Write-Host '  (Prochaine fois : raccourci "Rovex Hub" sur le Bureau)' -ForegroundColor Gray
Start-Process -FilePath $launcher -WorkingDirectory $Dir
`;

const bat = crlf(`@echo off
setlocal
title Installation de Rovex Hub
set "RDH_SELF=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText($env:RDH_SELF); $m='#PS'+'-START#'; try { iex $s.Substring($s.IndexOf($m)+$m.Length) } catch { Write-Host ''; Write-Host ('  ERREUR : '+$_.Exception.Message) -ForegroundColor Red }"
echo.
pause
exit /b
#PS-START#
${ps}`);

fs.writeFileSync(OUT, bat);
console.log(`OK : ${OUT} (${(bat.length / 1024).toFixed(0)} Ko)`);
