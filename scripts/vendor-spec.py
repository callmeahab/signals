#!/usr/bin/env python3
"""Vendor a supplied signals-spec tag for review; never infer a wire contract."""
import argparse, hashlib, json, shutil
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument("source",type=Path);p.add_argument("--tag",required=True);p.add_argument("--source-url",required=True)
a=p.parse_args();root=Path(__file__).resolve().parents[1];dest=root/"spec"/"upstream"
if dest.exists(): raise SystemExit("spec/upstream already exists; review/remove the previous vendored tag first")
required=["events.schema.json","ingest.openapi.yaml"]
for name in required:
 if not (a.source/name).is_file(): raise SystemExit(f"Missing {name}")
if not (a.source/"fixtures").is_dir(): raise SystemExit("Missing upstream fixtures directory")
shutil.copytree(a.source,dest,ignore=shutil.ignore_patterns(".git","node_modules"))
files={str(f.relative_to(dest)):hashlib.sha256(f.read_bytes()).hexdigest() for f in dest.rglob("*") if f.is_file()}
(root/"spec"/"upstream-manifest.json").write_text(json.dumps({"mode":"vendored-unverified","tag":a.tag,"source":a.source_url,"sha256":files},indent=2)+"\n")
print("Vendored without activating. Review schema/batch mapping, generated types and fixture adapter; see spec/README.md.")
