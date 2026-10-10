#!/usr/bin/env python3
"""Fail when a collector disagrees with signals-spec ingest.mjs on two contract cases.

The size case is an event whose JSON.stringify form is exactly 16384 bytes while
eight whole numbers are spelled ``1.0`` on the wire. CONTRACT.md defines
"serialised" as compact JSON.stringify, so the reference accepts it. The UTF-8
case is ``0xFF`` plus 1001 non-blank ``{}`` lines: invalid UTF-8 is
``400 malformed_body`` before NDJSON parsing, so the reference does not return
``413 too_many_events``.

Controls that must keep matching are included: a short invalid UTF-8 JSON body,
the same event with canonical ``1`` at 16384 bytes, and that event at 16385 bytes.

Requires a collector with a 30-day retention window and an ingest key. Event
timestamps are rewritten to the current UTC instant, so
``SIGNALS_CONFORMANCE_CLOCK`` may be either unset or ``sent_at``.

    SIGNALS_API_KEY=... python3 reports/review-r1/probe.py --url http://127.0.0.1:PORT

``SIGNALS_SPEC`` defaults to ``/home/vuk/orca/projects/signals-spec``.
Exits 0 only when every case matches the reference status, error code, and
202 ``accepted`` / ``rejected`` list. Human ``message`` text is not compared.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.request


ROOT = Path(__file__).resolve().parents[2]
REFERENCE = Path(__file__).resolve().parent / "reference.mjs"
SPEC = os.environ.get("SIGNALS_SPEC", "/home/vuk/orca/projects/signals-spec")


def now_stamp():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def reference(cmd, *args, body=None):
    result = subprocess.run(
        ["node", str(REFERENCE), cmd, SPEC, *args],
        input=body,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        sys.stderr.write(result.stderr.decode())
        raise SystemExit(f"reference {cmd} failed ({result.returncode})")
    return json.loads(result.stdout)


def post(url, key, body, content_type):
    request = urllib.request.Request(
        url.rstrip("/") + "/v1/events",
        data=body,
        headers={
            "Authorization": "Bearer " + key,
            "Content-Type": content_type,
        },
    )
    try:
        response = urllib.request.urlopen(request, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        payload = response.read()
        try:
            data = json.loads(payload)
        except ValueError:
            data = {"non_json": payload.decode(errors="replace")}
    rejected = data.get("rejected")
    if isinstance(rejected, list):
        rejected = [{"index": item.get("index"), "reason": item.get("reason")} for item in rejected]
    return {
        "status": response.status,
        "error": data.get("error"),
        "accepted": data.get("accepted") if "accepted" in data else None,
        "rejected": rejected if "rejected" in data else None,
        "keys": sorted(data),
        "body": data,
    }


def matches(actual, expected):
    if actual["status"] != expected["status"] or actual["error"] != expected["error"]:
        return False
    if expected["status"] == 202:
        return actual["accepted"] == expected["accepted"] and actual["rejected"] == expected["rejected"]
    return isinstance(actual["body"].get("message"), str) and set(actual["keys"]) >= {"error", "message"}


def show(name, ok, actual, expected, extra=None):
    print(("PASS " if ok else "FAIL ") + name)
    detail = {"collector": {k: actual[k] for k in ("status", "error", "accepted", "rejected", "keys")}, "reference": expected}
    if extra:
        detail.update(extra)
    print(json.dumps(detail, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    args = parser.parse_args()
    key = os.environ["SIGNALS_API_KEY"]
    failures = []

    short = reference("verdict", "json", body=b"\xff")
    actual = post(args.url, key, b"\xff", "application/json")
    ok = matches(actual, short)
    show("utf8 invalid short json", ok, actual, short)
    if not ok:
        failures.append("utf8 invalid short json")

    ndjson = b"\xff\n" + b"{}\n" * 1001
    expected = reference("verdict", "ndjson", body=ndjson)
    actual = post(args.url, key, ndjson, "application/x-ndjson")
    ok = matches(actual, expected)
    show("utf8 invalid ndjson over event count", ok, actual, expected, {"ndjson_lines": 1002})
    if not ok:
        failures.append("utf8 invalid ndjson over event count")

    fixture = ROOT / "spec" / "fixtures" / "valid" / "tool-called.json"
    sizes = reference("sizes", str(fixture), now_stamp())
    for name in ("canonical_16384", "canonical_16385", "wire_1_0_js_16384"):
        case = sizes[name]
        body = case["body"].encode()
        actual = post(args.url, key, body, "application/json")
        ok = matches(actual, case["verdict"])
        show(name, ok, actual, case["verdict"], {"jsEventBytes": case["jsEventBytes"]})
        if not ok:
            failures.append(name)

    print(f"{5 - len(failures)} passed, {len(failures)} failed")
    for name in failures:
        print(" - " + name)
    return int(bool(failures))


if __name__ == "__main__":
    raise SystemExit(main())
