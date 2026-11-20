#!/usr/bin/env python3
"""Uploads the signed release APK and latest.json to Tencent COS for the in-app update check.

    python3 tools/upload_release_to_cos.py --changelog "这一版改了什么"

Credentials come from the environment or from the file named by COS_ENV_FILE (default
tools/.env, not in Git): COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION.
Objects go under the `lingdaily/` prefix; the app reads <public base>/lingdaily/latest.json.
"""
import argparse, hashlib, hmac, http.client, json, os, re, sys, time, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREFIX = "lingdaily"
PUBLIC_BASE = "https://deploy.shiying.sh.cn"


def load_env(path):
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def authorization(secret_id, secret_key, path, headers):
    start = int(time.time()) - 60
    sign_time = f"{start};{start + 600}"
    quote = lambda value: urllib.parse.quote(str(value), safe="-_.~")
    names = sorted(headers)
    fields = "&".join(f"{quote(name)}={quote(headers[name])}" for name in names)
    digest = hashlib.sha1(f"put\n{path}\n\n{fields}\n".encode()).hexdigest()
    sign_key = hmac.new(secret_key.encode(), sign_time.encode(), hashlib.sha1).hexdigest()
    signature = hmac.new(sign_key.encode(), f"sha1\n{sign_time}\n{digest}\n".encode(), hashlib.sha1).hexdigest()
    return (f"q-sign-algorithm=sha1&q-ak={secret_id}&q-sign-time={sign_time}&q-key-time={sign_time}"
            f"&q-header-list={';'.join(names)}&q-url-param-list=&q-signature={signature}")


def put(host, key, body, content_type, cache_control):
    path = "/" + urllib.parse.quote(key, safe="/-_.~")
    signed = {"host": host, "content-length": str(len(body)), "content-type": content_type, "cache-control": cache_control}
    headers = {"Host": host, "Content-Length": str(len(body)), "Content-Type": content_type, "Cache-Control": cache_control,
               "Authorization": authorization(os.environ["COS_SECRET_ID"], os.environ["COS_SECRET_KEY"], path, signed)}
    connection = http.client.HTTPSConnection(host, timeout=120)
    try:
        connection.request("PUT", path, body=body, headers=headers)
        response = connection.getresponse()
        detail = response.read().decode("utf-8", "replace")
    finally:
        connection.close()
    if not 200 <= response.status < 300:
        sys.exit(f"upload failed {key}: HTTP {response.status}\n{detail[:500]}")
    print(f"uploaded: {key}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apk", type=Path, default=ROOT / "app/build/outputs/apk/release/app-release.apk")
    parser.add_argument("--changelog", default="")
    args = parser.parse_args()
    load_env(Path(os.environ.get("COS_ENV_FILE", ROOT / "tools/.env")))
    missing = [name for name in ("COS_SECRET_ID", "COS_SECRET_KEY", "COS_BUCKET", "COS_REGION") if not os.environ.get(name)]
    if missing:
        sys.exit("missing: " + ", ".join(missing))
    gradle = (ROOT / "app/build.gradle.kts").read_text()
    code = int(re.search(r"versionCode\s*=\s*(\d+)", gradle).group(1))
    name = re.search(r'versionName\s*=\s*"([^"]+)"', gradle).group(1)
    apk = args.apk.read_bytes()
    apk_key = f"{PREFIX}/LingDaily-v{name}.apk"
    latest = {"versionCode": code, "versionName": name, "apkUrl": f"{PUBLIC_BASE}/{apk_key}",
              "sha256": hashlib.sha256(apk).hexdigest(), "changelog": args.changelog}
    host = f"{os.environ['COS_BUCKET']}.cos.{os.environ['COS_REGION']}.myqcloud.com"
    # The APK first: latest.json must never point at a file that is not there yet.
    put(host, apk_key, apk, "application/vnd.android.package-archive", "public, max-age=31536000, immutable")
    put(host, f"{PREFIX}/latest.json", json.dumps(latest, ensure_ascii=False, indent=2).encode(), "application/json; charset=utf-8", "no-cache")
    print(json.dumps(latest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
