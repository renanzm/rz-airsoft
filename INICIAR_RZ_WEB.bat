@echo off
chcp 65001 >nul
title RZ Airsoft
cd /d "%~dp0"
where python >nul 2>&1
if errorlevel 1 (
  echo Python nao foi encontrado.
  echo Instale o Python 3 em https://www.python.org/downloads/ e marque "Add python.exe to PATH".
  pause
  exit /b 1
)
python server\app.py
if errorlevel 1 (
  echo.
  echo O servidor encerrou com erro. Veja a mensagem acima.
  pause
)
