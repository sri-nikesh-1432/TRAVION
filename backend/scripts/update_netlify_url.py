#!/usr/bin/env python3
"""
TRAVION — Update netlify.toml with new Render backend URL.

Usage:
  python scripts/update_netlify_url.py --url https://travion-api-abc123.onrender.com

This updates the proxy redirect in netlify.toml so the Netlify frontend
routes all /api/v1/* requests to the new Render deployment.
"""
import argparse
import os
import re
import sys


def update_netlify_toml(render_url: str):
    # Remove trailing slash
    render_url = render_url.rstrip("/")

    # Find netlify.toml (repo root, one level above backend/scripts/)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    toml_path = os.path.join(script_dir, "..", "..", "netlify.toml")
    toml_path = os.path.abspath(toml_path)

    if not os.path.exists(toml_path):
        print(f"ERROR: netlify.toml not found at {toml_path}")
        sys.exit(1)

    with open(toml_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Replace any existing onrender.com redirect
    new_redirect = f'  to = "{render_url}/:splat"'
    new_content, count = re.subn(
        r'  to = "https://[^"]+\.onrender\.com[^"]*"',
        new_redirect,
        content,
    )

    if count == 0:
        print("WARNING: Could not find an onrender.com redirect to replace.")
        print("Please manually update netlify.toml line 27.")
        sys.exit(1)

    with open(toml_path, "w", encoding="utf-8") as f:
        f.write(new_content)

    print(f"\n[OK] netlify.toml updated!")
    print(f"     Proxy: /api/v1/* → {render_url}/:splat")
    print(f"\nNext steps:")
    print(f"  git add netlify.toml")
    print(f"  git commit -m \"chore: point Netlify proxy to new Render deployment\"")
    print(f"  git push origin main")
    print(f"\nAlso set in Netlify dashboard (Site configuration → Environment variables):")
    print(f"  VITE_API_BASE_URL = {render_url}/api/v1")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True, help="New Render backend URL (e.g., https://travion-api-abc123.onrender.com)")
    args = parser.parse_args()
    update_netlify_toml(args.url)
