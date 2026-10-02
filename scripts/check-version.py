#!/usr/bin/env python3
import json, re, sys
from pathlib import Path
r=Path(__file__).resolve().parents[1];tag=sys.argv[1];match=re.fullmatch(r"signals-v(\d+\.\d+\.\d+)",tag);assert match,"Use signals-vMAJOR.MINOR.PATCH"
version=match.group(1);assert re.search(r'(?m)^version = "([^"]+)"$',(r/"Cargo.toml").read_text())[1]==version
assert json.loads((r/"web/packages/ui/package.json").read_text())["version"]==version
print("Matching release version:",version)
