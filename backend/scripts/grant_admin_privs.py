import pymysql

conn = pymysql.connect(host='127.0.0.1', port=3307, user='root', password='')
with conn.cursor() as cur:
    for host in ['localhost', '127.0.0.1', '%', '::1']:
        try:
            cur.execute(f"CREATE USER IF NOT EXISTS 'travion'@'{host}' IDENTIFIED WITH mysql_native_password BY 'travionpassword'")
        except Exception as e:
            print(f"create on {host}: {e}")
        try:
            cur.execute(f"ALTER USER 'travion'@'{host}' IDENTIFIED WITH mysql_native_password BY 'travionpassword'")
            cur.execute(f"GRANT ALL PRIVILEGES ON *.* TO 'travion'@'{host}' WITH GRANT OPTION")
        except Exception as e:
            print(f"alter on {host}: {e}")
    cur.execute("FLUSH PRIVILEGES")
conn.commit()
conn.close()
print("Successfully updated travion user to mysql_native_password on all hosts!")
