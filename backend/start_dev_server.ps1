# Starts the TRAVION backend API against the local MySQL 8.0.40 server.
# Durable: launch detached so it survives the terminal/session that started it.
#
#   powershell -ExecutionPolicy Bypass -File backend\start_dev_server.ps1
#
# MySQL must be online first (see C:\Users\chint\travion_mysql\my.ini):
#   Start-Process "C:\Users\chint\mysql-8.0.40-winx64\bin\mysqld.exe" `
#     -ArgumentList "--defaults-file=C:\Users\chint\travion_mysql\my.ini" -WindowStyle Hidden
$ErrorActionPreference = "Stop"
$env:DATABASE_URL = "mysql+pymysql://travion:travion_local_dev@127.0.0.1:3307/travion_db?charset=utf8mb4&collation=utf8mb4_unicode_ci"
Set-Location $PSScriptRoot
python -m uvicorn app.main:app --host 127.0.0.1 --port 8002 *>&1 |
    Tee-Object -FilePath (Join-Path $PSScriptRoot "uvicorn.log")
