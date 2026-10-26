@echo off
cd /d "%~dp0"
echo Starte AleNote Server...
echo Admin-Konsole: http://localhost:8787/admin
node server.js
pause
