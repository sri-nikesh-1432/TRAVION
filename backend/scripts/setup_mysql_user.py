import pymysql

conn = pymysql.connect(host='127.0.0.1', port=3307, user='root', password='')
with conn.cursor() as cur:
    for host in ['localhost', '127.0.0.1', '%']:
        try:
            cur.execute(f"CREATE USER IF NOT EXISTS 'travion'@'{host}' IDENTIFIED BY 'travionpassword'")
        except Exception:
            pass
        cur.execute(f"ALTER USER 'travion'@'{host}' IDENTIFIED BY 'travionpassword'")
        cur.execute(f"GRANT ALL PRIVILEGES ON travion_db.* TO 'travion'@'{host}'")
        cur.execute(f"GRANT ALL PRIVILEGES ON travion.* TO 'travion'@'{host}'")
    cur.execute("CREATE DATABASE IF NOT EXISTS travion_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
    cur.execute("CREATE DATABASE IF NOT EXISTS travion CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
    cur.execute("FLUSH PRIVILEGES")
conn.commit()
conn.close()
print("Successfully initialized travion MySQL user and databases on port 3307")
