@echo off
setlocal
chcp 65001 >nul
rem Supply installation locations; no machine-specific defaults.
if "%~1"=="" goto usage
if "%~2"=="" goto usage
set "NAPCAT_DIR=%~1"
set "QQPath=%~2"
cd /d "%NAPCAT_DIR%"
if errorlevel 1 exit /b 1
if not exist "%QQPath%" (
    echo QQ executable not found: %QQPath%
    pause
    exit /b 1
)
if not exist "NapCatWinBootMain.exe" (
    echo NapCat launcher not found in current directory.
    pause
    exit /b 1
)
set "NAPCAT_PATCH_PACKAGE=%cd%\qqnt.json"
set "NAPCAT_LOAD_PATH=%cd%\loadNapCat.js"
set "NAPCAT_INJECT_PATH=%cd%\NapCatWinBootHook.dll"
set "NAPCAT_LAUNCHER_PATH=%cd%\NapCatWinBootMain.exe"
set "NAPCAT_MAIN_PATH=%cd%\napcat.mjs"
set "NAPCAT_MAIN_PATH=%NAPCAT_MAIN_PATH:\=/%"
echo (async () =^> {await import("file:///%NAPCAT_MAIN_PATH%")})() > "%NAPCAT_LOAD_PATH%"
"%NAPCAT_LAUNCHER_PATH%" "%QQPath%" "%NAPCAT_INJECT_PATH%" %*
exit /b %errorlevel%
:usage
echo Usage: start-napcat.bat "NapCat folder" "Full path to QQ.exe"
exit /b 1
