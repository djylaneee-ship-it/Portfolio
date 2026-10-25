// Génère « Installer Roblox Dev Hub.bat » : un seul fichier qui contient toute l'app.
// Usage : node build-installer.js
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, '..', 'Installer Roblox Dev Hub.bat');
const FILES = [
  'db.js', 'mcp.js', 'server.js', 'web.js', 'seed.json', 'package.json', 'README.md',
  'public/index.html', 'public/style.css', 'public/app.js',
  'Lancer Roblox Dev Hub.bat', 'Relier a Claude.bat',
];

const crlf = (s) => s.replace(/\r?\n/g, '\r\n');

const UNINSTALL = crlf(`@echo off
echo Desinstallation de Roblox Dev Hub...
where claude >nul 2>nul && claude mcp remove --scope user roblox-dev-hub >nul 2>nul
del "%USERPROFILE%\\Desktop\\Roblox Dev Hub.lnk" >nul 2>nul
del "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Roblox Dev Hub.lnk" >nul 2>nul
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
Write-Host '     ROBLOX DEV HUB  -  Installation' -ForegroundColor Magenta
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
$launcher = Join-Path $Dir 'Lancer Roblox Dev Hub.bat'
$shell = New-Object -ComObject WScript.Shell
$targets = @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'))
foreach ($t in $targets) {
  $lnk = $shell.CreateShortcut((Join-Path $t 'Roblox Dev Hub.lnk'))
  $lnk.TargetPath = $launcher
  $lnk.WorkingDirectory = $Dir
  $lnk.WindowStyle = 7
  $lnk.IconLocation = "$env:SystemRoot\\System32\\imageres.dll,186"
  $lnk.Description = 'Bibliotheque de ressources de dev Roblox'
  $lnk.Save()
}
Ok 'Raccourci "Roblox Dev Hub" cree'

Step 'Connexion a Claude Code'
$mcp = Join-Path $Dir 'mcp.js'
$hint = "claude mcp add --scope user roblox-dev-hub -- node \`"$mcp\`""
$claudeOk = $false
if (Get-Command claude -ErrorAction SilentlyContinue) {
  try { $null = & claude --version 2>&1; $claudeOk = ($LASTEXITCODE -eq 0) } catch { $claudeOk = $false }
}
if ($claudeOk) {
  try {
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    & claude mcp remove --scope user roblox-dev-hub 2>$null | Out-Null
    & claude mcp add --scope user roblox-dev-hub -- node "$mcp" 2>&1 | Out-Null
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prev
    if ($code -eq 0) { Ok 'Claude Code peut maintenant utiliser ta base' } else { Warn "Echec. Lance plus tard : $hint" }
  } catch { $ErrorActionPreference = 'Stop'; Warn "Echec. Lance plus tard : $hint" }
} else {
  Warn 'Claude Code est absent ou mal installe : etape ignoree (l''app marche quand meme).'
  Warn 'Une fois Claude Code repare, double-clique sur "Relier a Claude.bat" dans :'
  Warn $Dir
}

Write-Host ''
Write-Host '  Installation terminee ! Lancement de l''app...' -ForegroundColor Green
Write-Host '  (Prochaine fois : raccourci "Roblox Dev Hub" sur le Bureau)' -ForegroundColor Gray
Start-Process -FilePath $launcher -WorkingDirectory $Dir
`;

const bat = crlf(`@echo off
setlocal
title Installation de Roblox Dev Hub
set "RDH_SELF=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::ReadAllText($env:RDH_SELF); $m='#PS'+'-START#'; try { iex $s.Substring($s.IndexOf($m)+$m.Length) } catch { Write-Host ''; Write-Host ('  ERREUR : '+$_.Exception.Message) -ForegroundColor Red }"
echo.
pause
exit /b
#PS-START#
${ps}`);

fs.writeFileSync(OUT, bat);
console.log(`OK : ${OUT} (${(bat.length / 1024).toFixed(0)} Ko)`);
