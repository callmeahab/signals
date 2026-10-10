#!/usr/bin/env python3
"""Review round 2: hand-built contract edge cases, collector against the reference.

Each case posts exact bytes to a collector and runs the identical decoded bytes
through `conformance/src/lib/ingest.mjs`, comparing status, `error`, `accepted`
and the `rejected` list. It covers:

* numbers that leave the binary64 range on the wire (`1e400` -> Infinity and
  `1e-400` -> 0 in ECMAScript), which change the `JSON.stringify` size;
* a `\\uD800` lone-surrogate escape, which `JSON.parse` accepts;
* escaped control characters measured at the 16 KB event cap;
* the CONTRACT.md 1 whole-batch ordering for invalid UTF-8: (a) before the
  envelope line, (b) inside event line 1001, (c) inside a gzip body that
  decodes over 1 MB;
* NDJSON `\\r\\n` line endings.

    SIGNALS_API_KEY=... python3 reports/review-r2/edge_probe.py --url http://127.0.0.1:PORT

`SIGNALS_SPEC` defaults to /home/vuk/orca/projects/signals-spec. The collector
needs a 30-day retention window; timestamps are rewritten to now, so
`SIGNALS_CONFORMANCE_CLOCK` may be unset or `sent_at`.
"""
import argparse
import datetime
import gzip
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = Path(__file__).resolve().parent / "reference.mjs"
SPEC = os.environ.get("SIGNALS_SPEC", "/home/vuk/orca/projects/signals-spec")
BAD_MARKER = "@@INVALID_UTF8@@"
BATCH_BYTES = 1_048_576


def now_stamp():
    stamp = datetime.datetime.now(datetime.timezone.utc)
    return stamp.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def reference(kind, body, bytes_override=None):
    argv = ["node", str(REFERENCE), "verdict", SPEC, kind]
    if bytes_override is not None:
        argv.append(str(bytes_override))
    result = subprocess.run(argv, input=body, capture_output=True, check=False)
    if result.returncode != 0:
        sys.stderr.write(result.stderr.decode())
        raise SystemExit(f"reference failed ({result.returncode})")
    return json.loads(result.stdout)


def post(url, key, body, content_type, encoding=None):
    headers = {"Authorization": "Bearer " + key, "Content-Type": content_type}
    if encoding:
        headers["Content-Encoding"] = encoding
    request = urllib.request.Request(url.rstrip("/") + "/v1/events", data=body, headers=headers)
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
        "keys": sorted(data),
        "body": data,
    }


def compact(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def encode(text):
    """UTF-8 bytes, with every BAD_MARKER replaced by a bare 0xFF byte."""
    return text.encode("utf-8").replace(BAD_MARKER.encode(), b"\xff")


def fixture(name):
    return json.loads((ROOT / "spec" / "fixtures" / "valid" / f"{name}.json").read_text())


def one_event_batch(now, event_id):
    batch = fixture("custom")
    batch["sent_at"] = now
    event = batch["events"][0]
    event["id"] = event_id
    event["ts"] = now
    batch["events"] = [event]
    return batch, event


def ndjson_lines(now, count):
    """Envelope line plus `count` distinct valid custom event lines."""
    batch = fixture("custom")
    batch["sent_at"] = now
    template = batch["events"][0]
    lines = [compact({k: v for k, v in batch.items() if k != "events"})]
    for i in range(count):
        event = json.loads(json.dumps(template))
        event["ts"] = now
        event["id"] = "018f4c2a-7c3e-7a11-8b2d-%012x" % i
        lines.append(compact(event))
    return lines


def build_cases(now):
    cases = []

    # --- numbers outside the binary64 range ---------------------------------
    for label, token in [
        ("1e400 -> Infinity", "1e400"),
        ("-1e400 -> -Infinity", "-1e400"),
        ("1e-400 -> 0", "1e-400"),
        ("1e309 -> Infinity", "1e309"),
        ("401-digit integer", "1" + "0" * 400),
    ]:
        batch, event = one_event_batch(now, "018f4c2a-7c3e-7a11-8b2d-6e5f4a3b2c01")
        event["attrs"]["props"] = {"nums": ["@@T@@"]}
        cases.append((f"number {label}", "json", compact(batch).replace('"@@T@@"', token).encode(), None, None))

    # --- a lone surrogate escape -------------------------------------------
    batch, event = one_event_batch(now, "018f4c2a-7c3e-7a11-8b2d-6e5f4a3b2c02")
    event["attrs"]["props"] = {"s": "@@S@@"}
    cases.append(
        ("lone surrogate escape \\ud800", "json", compact(batch).replace('"@@S@@"', '"\\ud800"').encode(), None, None)
    )

    # --- escaped control characters measured at the event cap ---------------
    for offset in (0, 1):
        batch, event = one_event_batch(now, "018f4c2a-7c3e-7a11-8b2d-6e5f4a3b2c0%d" % (3 + offset))
        event["attrs"]["props"] = {"ctl": "\x01\x02\x1f\x08\x0c\n\r\t\\\"\u007f", "pad": ""}
        pad = 16384 + offset - len(compact(event).encode())
        event["attrs"]["props"]["pad"] = "p" * pad
        cases.append((f"escaped control chars at {16384 + offset}", "json", compact(batch).encode(), None, None))

    # --- CONTRACT.md 1: invalid UTF-8 ordering ---------------------------
    lines = ndjson_lines(now, 1001)
    # (a) invalid UTF-8 before the envelope line: 1002 non-blank lines
    cases.append(
        (
            "(a) invalid utf8 before envelope line, 1002 lines",
            "ndjson",
            encode(BAD_MARKER + "\n" + "\n".join(lines) + "\n"),
            None,
            None,
        )
    )
    # (b) invalid UTF-8 inside event line 1001 (the last of 1001 event lines)
    broken = list(lines)
    broken[-1] = broken[-1].replace('"EUR"', '"' + BAD_MARKER + '"')
    cases.append(
        ("(b) invalid utf8 inside event line 1001", "ndjson", encode("\n".join(broken) + "\n"), None, None)
    )
    # (b2) the same, with only 10 event lines so the count cannot fire
    short = ndjson_lines(now, 10)
    short[-1] = short[-1].replace('"EUR"', '"' + BAD_MARKER + '"')
    cases.append(
        ("(b2) invalid utf8 inside event line, 10 events", "ndjson", encode("\n".join(short) + "\n"), None, None)
    )
    # control: 1001 valid UTF-8 event lines with a non-JSON envelope line
    bad_envelope = ["not JSON"] + lines[1:]
    cases.append(
        (
            "control valid utf8, 1001 events, bad envelope line",
            "ndjson",
            encode("\n".join(bad_envelope) + "\n"),
            None,
            None,
        )
    )

    # (c) invalid UTF-8 inside a gzip body that decodes over 1 MB
    big = ndjson_lines(now, 20)
    padded = json.loads(big[1])
    padded["attrs"]["props"] = {"pad": "p" * 1_100_000}
    big[1] = compact(padded)
    raw = encode(BAD_MARKER + "\n" + "\n".join(big) + "\n")
    assert len(raw) > BATCH_BYTES, len(raw)
    cases.append(("(c) invalid utf8 in gzip decoding over 1MB", "ndjson", gzip.compress(raw), "gzip", None))
    # controls: valid UTF-8 over 1 MB, and invalid UTF-8 under 1 MB, both gzip
    control = encode("\n".join(big) + "\n")
    assert len(control) > BATCH_BYTES, len(control)
    cases.append(("control valid utf8 gzip over 1MB", "ndjson", gzip.compress(control), "gzip", None))
    small = ndjson_lines(now, 20)
    under = encode(BAD_MARKER + "\n" + "\n".join(small) + "\n")
    assert len(under) < BATCH_BYTES, len(under)
    cases.append(("control invalid utf8 gzip under 1MB", "ndjson", gzip.compress(under), "gzip", None))

    # --- NDJSON CRLF --------------------------------------------------------
    crlf = ndjson_lines(now, 3)
    cases.append(("ndjson crlf line endings", "ndjson", encode("\r\n".join(crlf) + "\r\n"), None, None))

    return cases


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    args = parser.parse_args()
    key = os.environ["SIGNALS_API_KEY"]
    now = now_stamp()
    cases = build_cases(now)

    failures = []
    for name, kind, body, encoding, override in cases:
        decoded = gzip.decompress(body) if encoding == "gzip" else body
        expected = reference(kind, decoded, override)
        content_type = "application/json" if kind == "json" else "application/x-ndjson"
        actual = post(args.url, key, body, content_type, encoding)
        ok = actual["status"] == expected["status"] and actual["error"] == expected["error"]
        if ok and expected["status"] == 202:
            ok = actual["accepted"] == expected["accepted"] and actual["rejected"] == expected["rejected"]
        if ok and expected["status"] != 202:
            ok = isinstance(actual["body"].get("message"), str)
        print(("PASS " if ok else "FAIL ") + name)
        print(
            json.dumps(
                {
                    "decodedBytes": len(decoded),
                    "collector": {k: actual[k] for k in ("status", "error", "accepted", "rejected", "keys")},
                    "reference": expected,
                },
                indent=2,
            )
        )
        if not ok:
            failures.append(name)

    print(f"{len(cases) - len(failures)} passed, {len(failures)} failed")
    for name in failures:
        print(" - " + name)
    return int(bool(failures))


if __name__ == "__main__":
    raise SystemExit(main())
