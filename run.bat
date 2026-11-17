@echo off
title ASGames Game Platform
color 0E
echo ========================================================
echo               ASG WIN - GAMING PLATFORM
echo ========================================================
echo.
echo Starting Local Web Server on Port 8000...
echo.
start "" "http://localhost:8000"
python -m http.server 8000
pause
