@echo off
REM Copies waveplayer.js from this folder into Spicetify's Extensions folder
REM and applies it. Double-click to run, or run from a terminal in this folder.
setlocal

set "SRC=%~dp0waveplayer.js"
if not exist "%SRC%" (
    echo Could not find waveplayer.js next to this script.
    pause
    exit /b 1
)

REM Ask Spicetify where its userdata lives; fall back to the usual path.
set "SPICE="
for /f "delims=" %%i in ('spicetify path userdata 2^>nul') do set "SPICE=%%i"
if not defined SPICE set "SPICE=%APPDATA%\spicetify"

set "DEST=%SPICE%\Extensions"
if not exist "%DEST%" mkdir "%DEST%"

echo Copying to: %DEST%
copy /y "%SRC%" "%DEST%\waveplayer.js" >nul || (
    echo Copy failed.
    pause
    exit /b 1
)

REM Harmless if it is already registered - the extension guards against
REM being loaded twice.
spicetify config extensions waveplayer.js
spicetify apply

echo.
echo Done. Spotify should have restarted with the new build.
pause
