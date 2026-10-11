#!/usr/bin/env python3
"""Compare dashboard analytics with SQL counts. Never print credentials."""
import json
import urllib.request
import http.cookiejar
from pathlib import Path

BASE = "http://10.8.0.11:8300"
ENV = Path("/home/vuk/signals-deploy/.env").read_text().splitlines()
settings = {k: json.loads(v) for k, v in (line.split("=", 1) for line in ENV if "=" in line)}
ROUTES = ["overview", "adoption", "tools", "reliability", "cost", "protocol"]


def login():
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    request = urllib.request.Request(
        BASE + "/v1/auth/login",
        headers={"Content-Type": "application/json", "Origin": BASE},
        data=json.dumps(
            {"email": settings["SIGNALS_BOOTSTRAP_EMAIL"], "password": settings["SIGNALS_BOOTSTRAP_PASSWORD"]}
        ).encode(),
    )
    with opener.open(request, timeout=20) as response:
        account = json.load(response)
        print("POST /v1/auth/login", response.status, "projects", [p["slug"] for p in account["projects"]])
    return opener, account


def get_json(opener, path):
    with opener.open(BASE + path, timeout=30) as response:
        return response.status, json.load(response)


def psql(sql):
    import subprocess

    result = subprocess.run(
        ["docker", "exec", "signals-postgres-1", "psql", "-U", "signals", "-d", "signals", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-F", "\t", "-c", sql],
        text=True,
        capture_output=True,
        check=True,
    )
    return result.stdout.strip()


def main():
    opener, account = login()
    out = {"projects": {}}
    for project in account["projects"]:
        slug = project["slug"]
        pid = project["id"]
        captured = {}
        for route in ROUTES:
            status, payload = get_json(opener, f"/v1/projects/{pid}/analytics/{route}?range=7d")
            print(slug, route, status, "keys", sorted(payload)[:12])
            captured[route] = payload
        window = captured["overview"]["range"]
        sql = psql(
            "SELECT count(*) FILTER (WHERE type='tool.called' AND ts>='{from_}' AND ts<'{to}') AS calls, "
            "count(*) FILTER (WHERE type='tool.called' AND ts>='{prev_from}' AND ts<'{prev_to}') AS prev "
            "FROM analytics_facts WHERE project_id='{pid}'".format(
                from_=window["from"],
                to=window["to"],
                prev_from=window["prev_from"],
                prev_to=window["prev_to"],
                pid=pid,
            )
        )
        calls, prev = [int(part) for part in sql.split("\t")]
        tiles = captured["overview"]["tiles"]
        tile_calls = tiles["tool_calls"]["value"]
        tile_prev = tiles["tool_calls"]["prev"]
        print(slug, "tool_calls api", tile_calls, "sql", calls, "prev api", tile_prev, "sql", prev)
        clients = psql(
            "SELECT coalesce(client_name,'') || ' ' || coalesce(client_version,'') || ' ' || count(*)::text "
            "FROM analytics_facts WHERE project_id='{pid}' AND type='tool.called' AND client_name LIKE 'e2e-v2%' "
            "AND ts>='{from_}' GROUP BY 1, client_name, client_version ORDER BY 1".format(pid=pid, from_=window["from"])
        )
        print(slug, "e2e-v2 clients")
        print(clients or "(none)")
        out["projects"][slug] = {
            "id": pid,
            "analytics": captured,
            "sql_tool_calls": calls,
            "sql_tool_calls_prev": prev,
            "tile_match": tile_calls == calls and tile_prev == prev,
            "e2e_clients": clients,
        }
    Path("reports/e2e-v2/analytics.json").write_text(json.dumps(out))
    print("WROTE reports/e2e-v2/analytics.json", "bytes", Path("reports/e2e-v2/analytics.json").stat().st_size)


if __name__ == "__main__":
    main()
