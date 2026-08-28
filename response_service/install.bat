@echo off
setlocal
cd /d "%~dp0.."

if not exist ".venv\Scripts\python.exe" (
    py -m venv .venv
    if errorlevel 1 goto :error
)

".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto :error

".venv\Scripts\python.exe" -m pip install -r "response_service\requirements.txt"
if errorlevel 1 goto :error

if not exist "response_service\.env" (
    copy /Y "response_service\.env.example" "response_service\.env" >nul
    echo Created response_service\.env. Edit it before starting the service.
) else (
    echo response_service\.env already exists; it was not overwritten.
)

echo.
echo Installation completed.
exit /b 0

:error
echo.
echo Installation failed. Review the messages above.
exit /b 1
