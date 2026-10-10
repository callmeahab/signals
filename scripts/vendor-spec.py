#!/usr/bin/env python3
"""Vendor immutable artifacts from a git tag; verification is a separate release gate."""
import argparse, hashlib, json, subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument("source",type=Path);p.add_argument("--tag",required=True);p.add_argument("--source-url",required=True)
a=p.parse_args();root=Path(__file__).resolve().parents[1];dest=root/"spec"
def git(*args): return subprocess.check_output(["git","-C",str(a.source),*args])
commit=git("rev-parse",a.tag+"^{}").decode().strip()
required=["events.schema.json","batch.schema.json","ingest.openapi.yaml"]
names=git("ls-tree","-r","--name-only",commit,"--",*required,"fixtures").decode().splitlines()
if not all(name in names for name in required):raise SystemExit("Tag lacks required schemas/OpenAPI")
# Remove stale fixtures from earlier pins, but never modify the source checkout.
for old in (dest/"fixtures").rglob("*"):
 if old.is_file() and str(old.relative_to(dest)) not in names:old.unlink()
files={}
for name in names:
 data=git("show",commit+":"+name);target=dest/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
 files[name]=hashlib.sha256(data).hexdigest()
(dest/"manifest.json").write_text(json.dumps({"mode":"vendored-unverified","conformance_verified":False,"tag":a.tag,"commit":commit,"source":a.source_url,"sha256":files},indent=2)+"\n")
print("Vendored "+commit+"; run spec-conformance.py before marking official/conformance_verified")
