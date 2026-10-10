#!/usr/bin/env python3
"""Review round 2, check 1: differential fuzzer for the serialised-size caps.

CONTRACT.md defines "serialised" as the compact UTF-8 JSON encoding of a value
and the reference measures `Buffer.byteLength(JSON.stringify(value))`. The 16 KB
event cap and the 2/4/8 KB `args`/`fields`/`props` caps therefore depend on
ECMAScript number spelling, not on the wire spelling and not on
`serde_json::to_vec`.

This probe builds batches whose numbers are written on the wire in forms that
differ from `JSON.stringify` (`1.0`, `-0.0`, `1e21`, `18446744073709551615`,
`1.5e300`, `5e-324`, integers beyond 2^53, ...), solves the pad string so the
measured container lands exactly on the cap and on cap+1, posts each body to a
collector, and runs the identical bytes through the reference pipeline
`conformance/src/lib/ingest.mjs`. Every status / error / accepted / rejected
verdict must match.

    SIGNALS_API_KEY=... python3 reports/review-r2/number_fuzz.py \
        --url http://127.0.0.1:PORT [--cases 500]

`SIGNALS_SPEC` defaults to /home/vuk/orca/projects/signals-spec. A collector
with a 30-day retention window is required; timestamps are rewritten to now, so
`SIGNALS_CONFORMANCE_CLOCK` may be unset or `sent_at`. Exits non-zero on any
mismatch and prints the offending body's number tokens, the reference size, and
both verdicts.
"""
import argparse
import datetime
import json
import os
import random
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HARNESS = Path(__file__).resolve().parent / "numbers.mjs"
SPEC = os.environ.get("SIGNALS_SPEC", "/home/vuk/orca/projects/signals-spec")

# Wire number tokens whose ECMAScript spelling is interesting: whole floats,
# negative zero, the 1e21 / 1e-7 exponent thresholds, denormals, values past
# 2^53 and past u64 that serde keeps exact but JavaScript rounds, and tokens
# whose own spelling already differs from the shortest round-trip form.
TOKENS = [
    # whole-valued floats: JSON.stringify writes no fractional part
    "1.0", "2.0", "-1.0", "-0.0", "0.0", "100.0", "1.00", "10.0", "1000000.0",
    "0e0", "-0e0", "1e0", "1.000000000000000", "1.10", "0.100", "1e+2", "1e2",
    "-1e2", "100e-2", "123.456e3", "1.5e3", "7e100", "1e1", "5.0e-1",
    # the exponent thresholds in ECMAScript Number::toString
    "1e20", "1e21", "1e22", "1E+21", "9.999999999999999e20", "1e-6", "1e-7",
    "1.1e-7", "0.000001", "0.0000001", "1e-5", "0.00001", "1e23", "6e-7",
    "2.5e-1", "1.23456789e-5",
    # integers past 2^53 (serde keeps them exact, JavaScript rounds)
    "9007199254740992", "9007199254740993", "4503599627370497",
    "72057594037927936", "9223372036854775807", "-9223372036854775808",
    "-9223372036854775809", "18446744073709551615", "18446744073709551616",
    "123456789012345680000", "1000000000000000100", "12345678901234567890",
    "184467440737095516150", "1234567890123456789012345678901234567890",
    "340282366920938463463374607431768211456",
    "100000000000000000000000000000000000000000000000000000000000000000000",
    # denormals and the magnitude extremes
    "5e-324", "4.9e-324", "1e-323", "2.2250738585072014e-308",
    "2.225073858507201e-308", "1.7976931348623157e308",
    "1.7976931348623157e+308", "8.98846567431158e307", "1.5e300",
    "-1.5e-300", "1e308", "1e-308", "-7e-100",
    # ordinary values and shortest-round-trip corner cases
    "0.1", "0.2", "0.3", "0.30000000000000004", "1.5", "3.141592653589793",
    "1.2345678901234567", "123456789.12345679", "-0.1", "1e-1", "0.5",
    "1.0000000000000002", "0.000001000000000000001", "0", "-0", "1", "-1",
    "255", "65535", "1e-10", "1e10", "1e15", "1e16", "1e17",
]

TARGETS = [
    ("event", "tool-called", 16384),
    ("event", "log", 16384),
    ("event", "custom", 16384),
    ("args", "tool-called", 2048),
    ("fields", "log", 4096),
    ("props", "custom", 8192),
]


def uuid7(counter):
    ms = 0x018F4C2A7C3E + counter
    return "%012x-7%03x-8%03x-%012x" % (
        ms & 0xFFFFFFFFFFFF,
        counter & 0xFFF,
        (counter >> 12) & 0xFFF,
        counter,
    )


def now_stamp():
    stamp = datetime.datetime.now(datetime.timezone.utc)
    return stamp.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def post(url, key, body):
    request = urllib.request.Request(
        url.rstrip("/") + "/v1/events",
        data=body,
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
    )
    try:
        response = urllib.request.urlopen(request, timeout=60)
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
        rejected = [{"index": r.get("index"), "reason": r.get("reason")} for r in rejected]
    return {
        "status": response.status,
        "error": data.get("error"),
        "accepted": data.get("accepted") if "accepted" in data else None,
        "rejected": rejected if "rejected" in data else None,
    }


def build_cases(count, seed):
    rng = random.Random(seed)
    cases = []
    counter = 0

    # Per-token isolation: one token in the measured container, at the cap and
    # one byte over it. A spelling that is k bytes wrong in either direction
    # flips exactly one of the two verdicts.
    for token in TOKENS:
        for target, fixture, cap in (TARGETS[0], TARGETS[3], TARGETS[4], TARGETS[5]):
            for offset in (0, 1):
                counter += 1
                cases.append(
                    {
                        "name": f"solo[{token}]{target}{offset:+d}",
                        "fixture": fixture,
                        "target": target,
                        "cap": cap,
                        "offset": offset,
                        "numbers": [token],
                        "id": uuid7(counter),
                    }
                )

    # Random mixed events near every cap.
    while len(cases) < count + len(TOKENS) * 8:
        counter += 1
        target, fixture, cap = rng.choice(TARGETS)
        offset = rng.choice([-1, 0, 0, 1, 1])
        numbers = [rng.choice(TOKENS) for _ in range(rng.randint(1, 12))]
        cases.append(
            {
                "name": f"mix{counter}",
                "fixture": fixture,
                "target": target,
                "cap": cap,
                "offset": offset,
                "numbers": numbers,
                "id": uuid7(counter),
            }
        )
    return cases


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--cases", type=int, default=500, help="random mixed cases (default 500)")
    parser.add_argument("--seed", type=int, default=20261010)
    args = parser.parse_args()
    key = os.environ["SIGNALS_API_KEY"]

    cases = build_cases(args.cases, args.seed)
    job = {"now": now_stamp(), "cases": cases}
    built = subprocess.run(
        ["node", str(HARNESS), SPEC, str(ROOT)],
        input=json.dumps(job).encode(),
        capture_output=True,
        check=False,
    )
    if built.returncode != 0:
        sys.stderr.write(built.stderr.decode())
        raise SystemExit(f"reference harness failed ({built.returncode})")

    checked = skipped = 0
    failures = []
    for line in built.stdout.decode().splitlines():
        if not line.strip():
            continue
        case = json.loads(line)
        if case.get("skipped"):
            skipped += 1
            continue
        actual = post(args.url, key, case["body"].encode())
        checked += 1
        if actual != case["verdict"]:
            failures.append((case, actual))
            if len(failures) <= 10:
                print("FAIL " + case["name"])
                print(
                    json.dumps(
                        {
                            "numbers": case["numbers"],
                            "target": case["target"],
                            "cap": case["cap"],
                            "offset": case["offset"],
                            "referenceSerialisedBytes": case["measured"],
                            "bodyBytes": case["bodyBytes"],
                            "collector": actual,
                            "reference": case["verdict"],
                        },
                        indent=2,
                    )
                )
                out = Path(ROOT) / "target" / "review-r2" / f"fail-{case['name']}.json"
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_text(case["body"])
                print(f"body written to {out}")

    print(f"{checked - len(failures)}/{checked} cases matched the reference ({skipped} unbuildable)")
    for case, actual in failures:
        print(f" - {case['name']}: collector {actual} reference {case['verdict']}")
    return int(bool(failures))


if __name__ == "__main__":
    raise SystemExit(main())
