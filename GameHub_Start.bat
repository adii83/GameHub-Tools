@echo off
setlocal

:: Memeriksa hak akses Administrator
NET SESSION >nul 2>&1
if %errorLevel% == 0 (
    goto :admin_ready
) else (
    echo Memerlukan hak Administrator. Meminta izin UAC...
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "%~s0", "", "", "runas", 1 >> "%temp%\getadmin.vbs"
    "%temp%\getadmin.vbs"
    del "%temp%\getadmin.vbs"
    exit /B
)

:admin_ready
:: Mengembalikan Path ke direktori asali batch script agar tidak macet di System32
cd /d "%~dp0"
echo ---------------------------------------------------
echo [INFO] BATCH SEDANG BERJALAN SEBAGAI ADMINISTRATOR!
echo ---------------------------------------------------

echo Menyiapkan environment path pendek untuk GameHub...
subst Z: "D:\My Project\gamehub" >nul 2>&1
set NUGET_PACKAGES=Z:\pkg
set PROJECT_PATH=Z:\desktop\GameHubDesktop\GameHubDesktop.csproj
set PUBLISH_DIR=Z:\desktop\GameHubDesktop\bin\Release\net8.0-windows\publish
set APP_DLL=%PUBLISH_DIR%\GameHub.dll

echo Menutup instance GameHub lama jika masih berjalan...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$targets = Get-CimInstance Win32_Process | Where-Object { " ^
  "($_.Name -eq 'dotnet.exe' -and $_.CommandLine -like '*GameHubDesktop.csproj*') -or " ^
  "($_.Name -eq 'dotnet.exe' -and $_.CommandLine -like '*GameHub.dll*') -or " ^
  "($_.Name -eq 'GameHub.exe')" ^
  "};" ^
  "if ($targets) { $targets | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} } }"

echo Publish aplikasi terbaru...
dotnet publish "%PROJECT_PATH%" -c Release
if errorlevel 1 (
    echo [ERROR] Publish gagal. Aplikasi tidak dijalankan.
    pause
    exit /B 1
)

if not exist "%APP_DLL%" (
    echo [ERROR] File aplikasi tidak ditemukan: %APP_DLL%
    pause
    exit /B 1
)

echo Menjalankan aplikasi GameHub Desktop dari hasil publish terbaru...
dotnet "%APP_DLL%"
