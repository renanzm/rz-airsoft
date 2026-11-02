@echo off
chcp 65001 >nul
title RZ Airsoft - redefinir senha
cd /d "%~dp0"
where python >nul 2>&1
if errorlevel 1 (
  echo Python nao foi encontrado.
  pause
  exit /b 1
)
echo Redefinir a senha de acesso do RZ Airsoft.
echo Use so neste computador. Ctrl+C cancela sem alterar nada.
echo.
python server\app.py --reset-password
echo.
pause
