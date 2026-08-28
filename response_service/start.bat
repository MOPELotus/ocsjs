@echo off
setlocal
cd /d "%~dp0.."

if not exist ".venv\Scripts\python.exe" (
    echo Python virtual environment was not found.
    echo Run response_service\install.bat first.
    pause
    exit /b 1
)

if not exist "response_service\.env" (
    echo response_service\.env was not found.
    echo Run response_service\install.bat and edit the generated .env file first.
    pause
    exit /b 1
)

".venv\Scripts\python.exe" -m uvicorn response_service.app:app --host 0.0.0.0 --port 8000 --env-file "response_service\.env"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo Service exited with code %EXIT_CODE%.
    pause
)

exit /b %EXIT_CODE%
