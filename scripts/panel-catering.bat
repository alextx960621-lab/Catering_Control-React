@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

if not exist "scripts\difundir.mjs" (
  echo ERROR: no se encuentra scripts\difundir.mjs en esta carpeta.
  echo Este .bat tiene que estar en la raiz de "Catering Control" ^(al lado de la carpeta scripts^).
  pause
  exit /b
)

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: no se encontro Node.js. Instalalo desde https://nodejs.org ^(version LTS^) y volve a abrir este archivo.
  pause
  exit /b
)

:menu
cls
echo ============================================
echo   Catering Control - Panel de control
echo ============================================
echo.
echo   1. Actualizar UNA empresa
echo   2. Actualizar TODAS las empresas
echo   3. Ver inventario de versiones
echo   4. Crear una empresa nueva
echo   5. Salir
echo.
set "opcion="
set /p opcion="Elegi una opcion (1-5): "

if "%opcion%"=="1" goto actualizar_una
if "%opcion%"=="2" goto actualizar_todas
if "%opcion%"=="3" goto versiones
if "%opcion%"=="4" goto nueva_empresa
if "%opcion%"=="5" exit /b
goto menu

:actualizar_una
cls
node scripts\difundir.mjs --list
echo.
set "empresa="
set /p empresa="Escribi el nombre exacto de la empresa de arriba (o 'volver'): "
if /i "%empresa%"=="volver" goto menu
if "%empresa%"=="" goto actualizar_una
call :difundir_empresa "%empresa%"
echo.
pause
goto menu

:actualizar_todas
cls
call :difundir_empresa "Green Fork"
echo.
echo --------------------------------------------
call :difundir_empresa "In Shape Catering"
echo.
pause
goto menu

:versiones
cls
node scripts\versiones.mjs
echo.
pause
goto menu

:nueva_empresa
cls
echo Para crear una empresa nueva hacen falta dos datos obligatorios.
echo Los demas ^(WhatsApp, Instagram, logo, moneda, idioma...^) se pueden
echo cargar despues a mano en public\config.js, o volviendo a correr
echo el script con mas parametros ^(ver Guia-Nueva-Empresa-React.docx
echo dentro de la carpeta install^).
echo.
set "ref="
set "nombreemp="
set /p ref="Project ref de Supabase (20 caracteres, de la URL del proyecto): "
set /p nombreemp="Nombre de la empresa (como se va a ver en la app): "
if "%ref%"=="" goto nueva_empresa
if "%nombreemp%"=="" goto nueva_empresa
echo.
echo Se crea la carpeta al lado de "Catering Control", o sea en
echo %~dp0..  ^(si no existe, el script la crea^). Despues, para copiarle
echo el codigo de la app, usá la opcion 1 y elegí ese nombre.
echo.
node scripts\nueva-empresa.mjs init --ref "%ref%" --empresa "%nombreemp%" --out "..\%nombreemp%"
echo.
pause
goto menu

:difundir_empresa
echo.
echo ---- Revisando cambios para %~1 (simulacion, no escribe nada) ----
node scripts\difundir.mjs --empresa "%~1"
echo.
set "confirmar="
set /p confirmar="Aplicar estos cambios a %~1? (S/N): "
if /i "%confirmar%"=="S" (
  node scripts\difundir.mjs --empresa "%~1" --aplicar
) else (
  echo Cancelado: no se aplico nada.
)
exit /b
