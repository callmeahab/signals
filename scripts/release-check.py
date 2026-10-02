#!/usr/bin/env python3
import hashlib, json
from pathlib import Path
r=Path(__file__).resolve().parents[1];m=json.loads((r/"spec/manifest.json").read_text())
assert m.get("mode")=="official" and m.get("conformance_verified") is True,"Stable release requires official signals-spec conformance"
assert m.get("source") and m.get("tag"),"Pin spec provenance"
for name in ["events.schema.json","ingest.openapi.yaml"]:
 assert m["sha256"][name]==hashlib.sha256((r/"spec"/name).read_bytes()).hexdigest(),f"Spec drift: {name}"
package=json.loads((r/"web/packages/ui/package.json").read_text())
assert package.get("repository"),"Configure the publishing repository and npm namespace ownership first"
print("Official contract release gate passed")
