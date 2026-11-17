@echo off
title ASGames Full-Stack Platform
color 0E
echo ========================================================
echo               ASGAMES - FULL-STACK PLATFORM
echo ========================================================
echo.
echo Starting ASGames Server on Port 10000...
echo.
echo [PLAYER APP]  http://localhost:10000
echo [ADMIN PANEL] http://localhost:10000/admin (Pass: admin123)
echo.
start "" "http://localhost:10000"
node server.js
pause
