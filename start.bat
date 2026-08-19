@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "node_modules" (
    echo [INFO] node_modules 不存在，執行 npm install...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install 失敗
        pause
        exit /b 1
    )
)

echo [INFO] 啟動 npm start...
call npm start

pause