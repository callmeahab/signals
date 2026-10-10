#!/usr/bin/env python3
"""Vendor a pinned spec checkout; fixture verification is a separate release gate."""
import argparse, hashlib, json, shutil, subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument("source",type=Path);p.add_argument("--tag",required=True);p.add_argument("--source-url",required=True)
a=p.parse_args();root=Path(__file__).resolve().parents[1];dest=root/"spec"
commit=subprocess.check_output(["git","-C",str(a.source),"rev-parse",a.tag],text=True).strip()
head=subprocess.check_output(["git","-C",str(a.source),"rev-parse","HEAD"],text=True).strip()
if commit != head: raise SystemExit("Source checkout must be at the requested tag")
required=["events.schema.json","batch.schema.json","ingest.openapi.yaml"]
files={}
for name in required:
 shutil.copyfile(a.source/name,dest/name)
for source in (a.source/"fixtures").rglob("*"):
 if source.is_file():
  target=dest/source.relative_to(a.source);target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
for source in [*(dest/name for name in required),*(dest/"fixtures").rglob("*")]:
 if source.is_file():files[str(source.relative_to(dest))]=hashlib.sha256(source.read_bytes()).hexdigest()
(dest/"manifest.json").write_text(json.dumps({"mode":"vendored-unverified","conformance_verified":False,"tag":a.tag,"commit":commit,"source":a.source_url,"sha256":files},indent=2)+"\n")
print("Vendored; run spec-conformance.py before marking official/conformance_verified")
