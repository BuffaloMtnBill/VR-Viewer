@echo off
setlocal
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
    py -3 -m venv .venv
    if errorlevel 1 exit /b 1
    .venv\Scripts\python.exe -m pip install -e ".[voice]"
    if errorlevel 1 exit /b 1
)
.venv\Scripts\python.exe app.py %*
if errorlevel 1 pause
