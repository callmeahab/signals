#!/usr/bin/env python3
"""Review round 2, check 4: the vendored spec is intact and untouched.

Three independent assertions:

1. every `sha256` entry in `spec/manifest.json` matches the vendored file on
   disk, and no vendored file is missing from the manifest;
2. every vendored file is byte-identical to the same path in the frozen spec
   checkout at the manifest's tag/commit (`git show <commit>:<path>`);
3. nothing under `spec/` changed since the commit round 1 reviewed: `git diff
   --stat <base>..HEAD -- spec` is empty, and so is
   `git status --porcelain -- spec`. The default base is `c1811a7`, the HEAD
   that `reviews/collector-ingest-r1.md` was written against, so this asserts
   the fix pass left the vendored spec alone.

    python3 reports/review-r2/manifest_check.py [--base c1811a7] \
        [--spec /home/vuk/orca/projects/signals-spec]
"""
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKIP = {"manifest.json"}

failures = []


def check(name, ok, detail=None):
    print(("PASS " if ok else "FAIL ") + name + ("" if detail is None else f": {detail}"))
    if not ok:
        failures.append(name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="c1811a7")
    parser.add_argument("--spec", default="/home/vuk/orca/projects/signals-spec")
    args = parser.parse_args()

    manifest = json.loads((ROOT / "spec" / "manifest.json").read_text())
    check("manifest mode is official", manifest.get("mode") == "official", manifest.get("mode"))
    check("manifest conformance_verified is true", manifest.get("conformance_verified") is True,
          manifest.get("conformance_verified"))
    commit = manifest.get("commit")
    check("manifest tag/commit are the frozen spec",
          (manifest.get("tag"), commit) == ("v1.0.15", "8cdcccbcd38841acfb8aad29eb493c0c9c7aa9e0"),
          f"{manifest.get('tag')} {commit}")

    # 1. manifest hashes against the files on disk
    mismatched, missing = [], []
    for rel, want in sorted(manifest["sha256"].items()):
        path = ROOT / "spec" / rel
        if not path.exists():
            missing.append(rel)
            continue
        got = hashlib.sha256(path.read_bytes()).hexdigest()
        if got != want:
            mismatched.append((rel, want, got))
    check(f"all {len(manifest['sha256'])} manifest hashes match the vendored files",
          not mismatched and not missing, f"mismatched={mismatched[:5]} missing={missing[:5]}")

    on_disk = {
        str(p.relative_to(ROOT / "spec"))
        for p in (ROOT / "spec").rglob("*")
        if p.is_file() and str(p.relative_to(ROOT / "spec")) not in SKIP
    }
    unlisted = sorted(on_disk - set(manifest["sha256"]))
    check("no vendored file is missing from the manifest", not unlisted, unlisted)

    # 2. the vendored bytes against the frozen spec checkout
    differs, absent = [], []
    for rel in sorted(manifest["sha256"]):
        out = subprocess.run(["git", "-C", args.spec, "show", f"{commit}:{rel}"],
                             capture_output=True, check=False)
        if out.returncode != 0:
            absent.append(rel)
            continue
        if hashlib.sha256(out.stdout).hexdigest() != manifest["sha256"][rel]:
            differs.append(rel)
    check(f"all {len(manifest['sha256'])} vendored files equal {commit[:7]} in the spec checkout",
          not differs and not absent, f"differs={differs[:5]} absent={absent[:5]}")

    # 3. spec/ untouched in the review range and in the working tree
    diff = subprocess.run(["git", "-C", str(ROOT), "diff", "--stat", f"{args.base}..HEAD", "--", "spec"],
                          capture_output=True, text=True, check=True).stdout.strip()
    check(f"spec/ is unchanged in {args.base}..HEAD", diff == "", diff.splitlines()[-1] if diff else "")
    dirty = subprocess.run(["git", "-C", str(ROOT), "status", "--porcelain", "--", "spec"],
                           capture_output=True, text=True, check=True).stdout.strip()
    check("spec/ is clean in the working tree", dirty == "", dirty)

    print(f"{'FAILED' if failures else 'OK'}: {len(failures)} failed")
    for name in failures:
        print(" - " + name)
    return int(bool(failures))


if __name__ == "__main__":
    raise SystemExit(main())
