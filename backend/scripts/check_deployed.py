import urllib.request
import json

urls = [
    'https://travion-api.onrender.com/health',
    'https://travions.netlify.app/api/v1/health',
    'https://travion-api.onrender.com/api/v1/health/db',
    'https://travions.netlify.app/api/v1/health/db'
]

for url in urls:
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read().decode('utf-8')
            print(f"{url} -> {resp.status} : {data[:200]}")
    except Exception as e:
        print(f"{url} -> ERROR: {e}")
