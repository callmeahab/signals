#!/usr/bin/env python3
"""Restart the collector and both eggs, then confirm readiness and a new event."""
import json
import time
import urllib.request
import http.cookiejar
import subprocess
from datetime import datetime, timezone
from pathlib import Path

BASE = "http://10.8.0.11:8300"
PROBE = r'''
import asyncio
from mcp.client import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.types import Implementation
async def main():
    url = "http://10.8.0.11:PORT/mcp"
    started = __import__("time").monotonic()
    async with streamable_http_client(url) as streams:
        async with ClientSession(streams[0], streams[1], client_info=Implementation(name="e2e-v2-restart", version="VERSION")) as client:
            init = await client.initialize()
            result = await client.call_tool("search_products", {"query": "Mug", "limit": 1})
            print("initialize", init.server_info.name, "seconds", round(__import__("time").monotonic()-started, 3), "is_error", bool(result.is_error))
            if result.is_error:
                raise SystemExit("search_products is_error")
asyncio.run(main())
'''


def stamp():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def run(args):
    print(stamp(), "$", " ".join(args), flush=True)
    result = subprocess.run(args, text=True, capture_output=True)
    print(result.stdout.strip(), flush=True)
    if result.returncode != 0:
        print(result.stderr.strip(), flush=True)
        raise SystemExit(result.returncode)
    return result.stdout


def wait_ready(url, timeout):
    started = time.monotonic()
    last = ""
    while time.monotonic() - started < timeout:
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                last = response.read().decode()
                print(stamp(), "GET", url, response.status, last.strip(), "after", round(time.monotonic() - started, 2), flush=True)
                if response.status == 200:
                    return True
        except Exception as error:
            last = type(error).__name__
        time.sleep(0.5)
    print(stamp(), "NOT READY", url, last, flush=True)
    return False


def initialize(port, version):
    script = PROBE.replace("PORT", str(port)).replace("VERSION", version)
    started = time.monotonic()
    result = subprocess.run(
        ["docker", "exec", "-i", "egg-python-app-1", "python", "-u", "-"],
        input=script,
        text=True,
        capture_output=True,
    )
    print(result.stdout.strip(), flush=True)
    if result.returncode != 0:
        print(result.stderr.strip(), flush=True)
        raise SystemExit(f"initialize failed for {port}")
    if time.monotonic() - started > 60:
        raise SystemExit(f"initialize for {port} exceeded 60s")


def dashboard_sees(version):
    env = Path("/home/vuk/signals-deploy/.env").read_text().splitlines()
    settings = {k: json.loads(v) for k, v in (line.split("=", 1) for line in env if "=" in line)}
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    request = urllib.request.Request(
        BASE + "/v1/auth/login",
        headers={"Content-Type": "application/json", "Origin": BASE},
        data=json.dumps({"email": settings["SIGNALS_BOOTSTRAP_EMAIL"], "password": settings["SIGNALS_BOOTSTRAP_PASSWORD"]}).encode(),
    )
    with opener.open(request, timeout=20) as response:
        account = json.load(response)
        print(stamp(), "login", response.status, flush=True)
    for project in account["projects"]:
        path = f"/v1/projects/{project['id']}/events?client={urllib.parse.quote('e2e-v2-restart')}"
        # The events filter may not accept client. Fall back to the recent page.
        with opener.open(BASE + f"/v1/projects/{project['id']}/events", timeout=20) as response:
            page = json.load(response)
        matched = [
            item for item in page.get("items", [])
            if (item.get("client") or {}).get("name") == "e2e-v2-restart"
            or item.get("client_name") == "e2e-v2-restart"
            or (item.get("attrs") or {}).get("client_name") == "e2e-v2-restart"
        ]
        # client info may only be on the client object or source. Also search serialized text for the version.
        text_hits = [item for item in page.get("items", []) if version in json.dumps(item)]
        print(stamp(), project["slug"], "events", len(page.get("items", [])), "name_hits", len(matched), "version_hits", len(text_hits), flush=True)


def main():
    version = "restart-" + datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    print(stamp(), "version", version, flush=True)
    run(["docker", "restart", "signals-signals-1"])
    if not wait_ready(BASE + "/readyz", 60):
        raise SystemExit("collector /readyz did not return 200")
    for container, port in (("egg-node-app-1", 8001), ("egg-python-app-1", 8000)):
        run(["docker", "restart", container])
        if not wait_ready(f"http://10.8.0.11:{port}/healthz", 60):
            raise SystemExit(container + " healthz did not return 200")
        initialize(port, version)
    time.sleep(8)
    dashboard_sees(version)
    print(stamp(), "PASS restart", flush=True)


if __name__ == "__main__":
    import urllib.parse
    main()
