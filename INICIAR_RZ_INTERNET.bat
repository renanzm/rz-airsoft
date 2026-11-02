@echo off
chcp 65001 >nul
title RZ Airsoft - acesso pela internet
cd /d "%~dp0"
where python >nul 2>&1
if errorlevel 1 (
  echo Python nao foi encontrado.
  echo Instale o Python 3 em https://www.python.org/downloads/ e marque "Add python.exe to PATH".
  pause
  exit /b 1
)
if not exist "%~dp0tools\cloudflared.exe" (
  where cloudflared >nul 2>&1
  if errorlevel 1 (
    echo Falta tools\cloudflared.exe
    echo Baixe o cloudflared da Cloudflare e coloque o arquivo nessa pasta,
    echo ou use INICIAR_RZ_WEB.bat para abrir so neste computador.
    pause
    exit /b 1
  )
)
echo Abrindo o RZ Airsoft com endereco publico...
echo O endereco https://....trycloudflare.com aparece abaixo e em Configuracoes ^> Acesso remoto.
echo Deixe esta janela aberta e o computador ligado. Ctrl+C encerra.
echo.
python server\app.py --tunnel
echo.
echo Acesso pela internet encerrado.
pause
