@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
call npm run dist
echo.
echo Fertig! Installer und portable EXE liegen im Ordner "dist".
pause
