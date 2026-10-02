# Wire contract status

`manifest.json` records the active contract. It is **provisional** until the official Plan 1 is supplied. The development JSON Schema, generated Rust types and fixtures verify local behavior; they do not establish SDK compatibility.

## Supply an official tag

```sh
python3 scripts/vendor-spec.py /path/to/signals-spec --tag v1.0.0 --source-url https://github.com/OWNER/signals-spec
```

The script preserves upstream files byte for byte under `spec/upstream`, with SHA-256 provenance. It does not activate unknown contract changes. Review the upstream batch envelope, fields, rejection reasons and conformance runner. Then copy the official schema and ingest OpenAPI verbatim into `spec/`, update the normalized mapping and `xtask` root name if needed, regenerate (`cargo run -p signals-xtask`), and adapt upstream fixtures to the runner interface below or invoke the upstream runner in CI. Commit the provenance, fixture adapter and passing evidence together.

Only after upstream conformance passes should the active manifest use `mode: official`, an exact source/tag, file hashes and `conformance_verified: true`. Release validation intentionally blocks provisional builds from being published as stable 1.x.

## Development fixture interface

`fixtures/development.json` contains `name`, a templated `batch`, `status`, `expected` response fields, and optional `replay`. `{{NOW}}` is a UTC timestamp; `{{UUID:name}}` is stable within one fixture and distinct between runs. `{{FUTURE}}` and `{{OLD}}` exercise timestamp checks. `scripts/conformance.py` sends fixtures to an isolated server using an ingest key. Official fixture formats may differ; their adapter cannot be implemented accurately before they are available.
