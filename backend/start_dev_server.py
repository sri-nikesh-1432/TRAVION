"""Durable TRAVION backend starter — direct child process (no powershell
wrapper, no pipeline), safe to launch detached:

    Start-Process python -ArgumentList "start_dev_server.py" -WindowStyle Hidden

or run in the foreground from the backend folder:

    python start_dev_server.py

DATABASE_URL defaults to the local MySQL 8.0.40 server (127.0.0.1:3307) and
can be overridden from the environment. Logs append to backend/uvicorn.log.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)
sys.path.insert(0, HERE)

os.environ.setdefault(
    "DATABASE_URL",
    "mysql+pymysql://travion:travion_local_dev@127.0.0.1:3307/travion_db"
    "?charset=utf8mb4&collation=utf8mb4_unicode_ci",
)

# Line-buffered UTF-8 log so a detached run leaves a readable trail.
_log = open(os.path.join(HERE, "uvicorn.log"), "a", encoding="utf-8", buffering=1)
sys.stdout = _log
sys.stderr = _log

import uvicorn  # noqa: E402

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=8002)
