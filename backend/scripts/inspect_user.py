import pymysql

conn = pymysql.connect(host='127.0.0.1', port=3307, user='root', password='', database='mysql')
with conn.cursor() as cur:
    cur.execute("SELECT user, host, plugin FROM mysql.user WHERE user='travion'")
    for r in cur.fetchall():
        print(r)
conn.close()
