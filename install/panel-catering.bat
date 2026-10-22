@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."

if not exist "scripts\panel.mjs" (
  echo ERROR: no se encuentra scripts\panel.mjs desde esta carpeta.
  echo Este .bat tiene que estar dentro de "Catering Control\install", sin mover la
  echo carpeta "Catering Control" de lugar.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: no se encontro Node.js. Instalalo desde https://nodejs.org ^(version LTS^) y volve a abrir este archivo.
  pause
  exit /b 1
)

node scripts\panel.mjs
if errorlevel 1 pause
exit /b
