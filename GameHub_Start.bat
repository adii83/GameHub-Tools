@echo off
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
echo Menjalankan aplikasi GameHub Desktop...
dotnet run --project Z:\desktop\GameHubDesktop\GameHubDesktop.csproj
