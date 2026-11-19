@echo off
rem Double-click to build a 3D map of your Markdown notes. Your notes are only read, never changed.
setlocal
chcp 65001 >nul
title Build My Brain
cd /d "%~dp0"

echo.
echo  Second Brain Black Hole: build a 3D map of your notes
echo  -----------------------------------------------------
echo.

where node >nul 2>nul
if errorlevel 1 goto :nonode
node -e "process.exit(+process.versions.node.split('.')[0] >= 18 ? 0 : 1)"
if errorlevel 1 goto :oldnode

if not exist "node_modules\markdown-it\" (
  echo First run: installing what the importer needs. This takes about a minute...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 goto :failed
  echo.
)

echo Pick your notes folder in the window that opens. It may be behind this one.
set "NOTES="
for /f "usebackq delims=" %%I in (`powershell -NoProfile -STA -Command "[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false; Add-Type -AssemblyName System.Windows.Forms; $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = 'Pick the folder that holds your .md notes'; if ($dialog.ShowDialog($owner) -eq 'OK') { $dialog.SelectedPath }"`) do set "NOTES=%%I"
if not defined NOTES (
  echo No folder was picked.
  set /p "NOTES=Type or paste the full path to your notes folder, or just press Enter to quit: "
)
if not defined NOTES goto :nofolder
set "NOTES=%NOTES:"=%"
rem A path ending in \ would escape the closing quote, so end it with \. instead
if "%NOTES:~-1%"=="\" set "NOTES=%NOTES%."
echo Notes folder: "%NOTES%"
echo.

set "OWNER="
set /p "OWNER=Name to show on your map (press Enter for 'My Brain'): "
if not defined OWNER set "OWNER=My Brain"
set "OWNER=%OWNER:"=%"

echo.
echo Building your map...
echo.
node scripts\import-markdown.mjs --owner "%OWNER%" --open "%NOTES%"
if errorlevel 1 goto :failed
echo.
echo Done. To rebuild after your notes change, double-click this file again.
goto :end

:nonode
echo Node.js is not installed, or Windows can't find it yet.
echo   1. Go to https://nodejs.org and download the LTS version.
echo   2. Install it with the default options.
echo   3. Close this window and double-click this file again.
echo If you just installed it, sign out of Windows and back in, then try again.
goto :end

:oldnode
for /f "delims=" %%V in ('node -v') do echo Your Node.js is %%V, which is too old. Version 18 or newer is needed.
echo Install the LTS version from https://nodejs.org, then double-click this file again.
goto :end

:nofolder
echo No folder given, so nothing was built.
goto :end

:failed
echo.
echo Something went wrong. The message above says why.

:end
echo.
pause
endlocal
