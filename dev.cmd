@echo off
rem Atajo para Windows: ejecuta el proyecto sin configurar PATH.
setlocal
cd /d "%~dp0"

set "NODEEXE=node"
where node >nul 2>nul || set "NODEEXE=%LOCALAPPDATA%\node-portable\node-v24.21.0-win-x64\node.exe"
if not "%NODEEXE%"=="node" if not exist "%NODEEXE%" (
  echo [amigo secreto] No se encontro Node.js 24. Instalalo desde https://nodejs.org y vuelve a intentarlo.
  exit /b 1
)

set "TAREA=%~1"
if "%TAREA%"=="" set "TAREA=dev"
if /i "%TAREA%"=="dev" goto :dev
if /i "%TAREA%"=="test" goto :test
if /i "%TAREA%"=="build" goto :build
if /i "%TAREA%"=="seed" goto :seed
if /i "%TAREA%"=="seed-prod" goto :seedprod
echo Uso: dev.cmd [dev^|test^|build^|seed^|seed-prod]
exit /b 1

:dev
echo [amigo secreto] Abre http://localhost:3000 - Ctrl+C para detener.
"%NODEEXE%" --env-file-if-exists=.env server/index.js
exit /b %errorlevel%

:test
"%NODEEXE%" --test --test-concurrency=1 test/game.test.js
exit /b %errorlevel%

:build
"%NODEEXE%" scripts/build.js
exit /b %errorlevel%

:seed
"%NODEEXE%" --env-file-if-exists=.env server/seed.js
exit /b %errorlevel%

:seedprod
if not exist ".env.production" (
  echo [amigo secreto] Falta .env.production. Revisa el README, seccion "Desplegar en Railway".
  exit /b 1
)
"%NODEEXE%" --env-file=.env.production server/seed.js
exit /b %errorlevel%
