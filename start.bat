@echo off
title Pixel Office Server
cd /d "%~dp0"

:loop
echo Starting Pixel Office Server...
node server.js
echo.
echo Server stopped. Restarting in 1 second...
timeout /t 1 /nobreak >nul
goto loop
