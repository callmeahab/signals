# Review round 1 — collector dashboard + examples migration to spec v1.0.15

Scope: `main..HEAD` (`3a20aaf`, `af46dc0`, `017bab4`) restricted to `web/` and
`examples/`. Spec: `/home/vuk/orca/projects/signals-spec` @ `fbb253a` (frozen
v1.0.15). Author's brief: `briefs/collector-dashboard.md`; author's report:
`reports/collector-dashboard.md`. Backend mismatches are out of scope by the
review brief; the Rust ingest path in this worktree still speaks the old contract.

## VERDICT: changes required

No blockers. One should-fix. Everything the author claims reproduces, the whole
web suite and `examples/smoke.py` pass on this box, both example servers and all
three Setup snippets were executed for real, and every batch the UI and the QA
scripts produce is accepted by the spec's reference collector.

## Blockers

None.

## Should-fix

### S1 — `SignalEvent.caller` omits `ip_hash`, the one caller field the collector always stores

`web/packages/ui/src/types.ts:17` declares the stored caller object as

```ts
caller?: { key_id?: string | null; subject?: string | null; user_agent?: string | null }
```

The stored form in CONTRACT.md §3 is the wire `caller` with `ip` **replaced by**
`ip_hash` (`CONTRACT.md:177-181`, `conformance/README.md:72`,
`fixtures/scenarios/README.md:153`): `key_id`, `subject`, `ip_hash`, `user_agent`.
`ip_hash` is the only caller identity a network caller has — it is what the
Callers screen's own copy refers to ("Network identities use a salted hash. Raw
peer IP addresses are never stored.", `dashboard.tsx:126`) and what the demo's
`kind:'network'` caller row stands for.

Reproduction — drive `examples/node/server.mjs` against the spec's mock
collector and look at what the collector stores:

```text
$ node reports/review-r1/node-sdk-probe.mjs
PASS examples/node/server.mjs: tools/call → 5, 5 events recorded by the spec mock: …
$ head -1 $PROBE_OUT/node-example-record.ndjson | python3 -m json.tool | grep -A3 caller
    "caller": {
        "user_agent": "node",
        "ip_hash": "9e50f1cb9145b7da029a8c9874527be0a24c5a70e38cca03cd2ad3c750f952d7"
    }
$ node reports/review-r1/field-audit-probe.mjs
SignalEvent.caller declares [key_id, subject, user_agent]; stored-form keys not declared: [ip_hash]
```

Every event the real SDK produces over HTTP carries `caller.ip_hash` once the
collector has stored it. Expected: the type lists the four stored-form keys.

Impact today is confined to the type: nothing in the UI reads `caller.*`, and the
expanded event row prints the raw JSON, so an `ip_hash` that arrives is still
shown. It matters because `reports/collector-dashboard.md` ("Remaining
integration boundary") nominates this very type as the read-model contract that
was sent to the coordinator for the parallel Rust worker — an implementer who
builds the read API from it will drop the field from the event payload. The fix
is one key: `ip_hash?: string | null`.

## Verified claims

Every command below was run by me from this worktree on this box (bun 1.4.2,
node 22.22.1, Python 3.14.4 / the SDK checkout's 3.10 venv). The author's report
is the source of the claims.

| Author's claim | My result |
|---|---|
| `cd web && bun install --frozen-lockfile` | **Reproduced.** `Checked 171 installs across 193 packages (no changes) [12.00ms]`, rc 0. No lockfile change. |
| `bun run check` passes | **Reproduced.** rc 0 (`build:ui` + `tsc --noEmit` + `eslint .`). |
| `bun run build` passes | **Reproduced.** rc 0, `index-iESOMJ4J.js 273.88 kB`, `✓ built in 228ms`. |
| `PLAYWRIGHT_CHANNEL=chromium bun run test` passes | **Reproduced.** rc 0. `Spec fixture QA passed: all 10 event types, …` then `Visual QA passed: 7 screens, light/dark, mobile/desktop, fonts, dialogs, live controls, spec events, SDK setup snippets, keys.` |
| plain `bun run test` fails because Chrome is absent | **Reproduced.** rc 1, `error: Browser checks failed (1)` (the Playwright `chrome` channel is not installed on this box; `chromium-1243` is). The author's brief permits the `PLAYWRIGHT_CHANNEL=chromium` override. |
| `bun run test:next` passes | **Reproduced.** rc 0, `✓ Compiled successfully`, `Next host passed: packed ESM/types/CSS, 7 screens, dialog charts and host styles.` No `BUN_INSTALL_CACHE_DIR` override was needed. |
| `python3 examples/smoke.py` passes | **Reproduced.** rc 0, two `PASS` lines plus the documented runtime caveat. |
| `node --check web/scripts/backend-qa.mjs` clean | **Reproduced.** rc 0, no output. |
| `git diff --check` clean | **Reproduced.** rc 0, no output. |
| grep finds no `tool.call"` / `session.start"` / `session.end"` / `SIGNALS_API_KEY` / `client_name` in `web/` and `examples/` | **Reproduced** over `git ls-files web examples` (minus PNGs), both with the brief's literal pattern and the author's quote-either-way variant: no matches. A wider sweep for `'request'`/`"request"`/`caller_ip`/bare `tool.call` also found only legitimate nested `attrs.is_error` and the `EventFilter.is_error` query parameter. |
| lockfiles unchanged | **Reproduced.** `git diff --stat main..HEAD -- web/bun.lock examples/next-host/bun.lock` is empty. |
| Python example imports with the installed SDKs; `add(2,3)==5`; non-finite input raises | **Reproduced** by re-running the author's exact `runpy` snippet against `/home/vuk/orca/projects/signals-python/.venv`. `uv sync --locked --extra mcp --dry-run` reports `Would make no changes`, so that environment already satisfies the brief's setup command; I did not mutate the shared checkout. |
| Node example serves `tools/call` over stateless HTTP and returns 5 | **Reproduced and strengthened.** Driven with the real `@modelcontextprotocol/sdk` client, not a hand-written POST: `tools/list` → `['add']`, `callTool add(2,3)` → `'5'`. |
| Live collector QA deliberately not run | **Accepted**; the author's brief states this worktree's backend still implements the old contract. `web/scripts/backend-qa.mjs` was instead verified offline (below). |
| Setup screenshots committed in `web/artifacts/` | **Verified.** The three tracked PNGs are byte-identical after my own `bun run test` run (`git hash-object` == `git rev-parse HEAD:…`), and they do show the new Setup screen with the SDK snippets and `SIGNALS_URL`/`SIGNALS_KEY`. |
| `repository` added so `scripts/release-check.py` is satisfied | **Verified.** `release-check.py:10` only requires a truthy `repository`; the string form satisfies it. (The script still exits on its earlier `spec/` provenance assertion at line 5 — that is `spec/`, outside this task's ownership.) |

### Review-brief checks

| Check | Result |
|---|---|
| 2 — field-level audit of `types.ts` / `dashboard.tsx` against `events.schema.json` | **Pass, with S1.** `reports/review-r1/field-audit-probe.mjs` walks every tracked `.ts/.tsx/.mjs` under `web/` and `examples/`: the attrs keys read are `duration_ms, error_message, is_error, level, message, method, name, prompt, tool, uri`, the client keys are `name, protocol_version, version`, the source keys are `instance_id, sdk` — all spec-defined. No field is read that the spec does not define. `EventType` is exactly the ten-value spec enum, `EventAttrs` declares no key outside the union of the ten types' attrs, and `SignalEvent`'s top-level keys are the spec envelope plus the two documented read-model additions (`caller_id`, `source`). The only divergence is S1. |
| 3 — run each Setup snippet for real | **Pass.** The snippets were captured from the rendered demo UI (not from source) by `reports/review-r1/setup-snippets-probe.mjs`. Python: written to a module and started with uvicorn from the signals-python venv — answers MCP `initialize` with `serverInfo` (`PASS Setup Python snippet: imports, starts under uvicorn and answers MCP initialize`). Node: run with only the `app`/`transport` its own comment tells the reader to supply, against the signals-node checkout's `@modelcontextprotocol/sdk@1.30.0`, express and zod — starts, answers `initialize`, nothing on stderr. Raw HTTP: validates against `batch.schema.json` and `events.schema.json`, passes `processBatch` (`202`, accepted 1, rejected 0), and the copied `curl` command run verbatim (only host:port redirected off the demo's hard-coded 8300) against `conformance/src/serve.mjs` returns `202 {"accepted":1,"rejected":[]}` and is recorded. The generated id is a well-formed UUIDv7 whose 48-bit prefix is the real `Date.now()`. |
| 4 — drive both example servers with a matching MCP client into the spec's mock collector | **Pass.** `examples/node/server.mjs`: `tools/list` → `['add']`, `add(2,3)` → `5`, and the mock recorded **5** events — `session.started` (`transport: synthetic`), `mcp.initialize`, `mcp.request` (`tools/list`), `tool.called` (`tool: add`), `session.ended` (`reason: shutdown`) — with `source.sdk=node`, `source.server_name=signals-node-example` and `caller.ip_hash`/`caller.user_agent`. Re-run against an install made exactly as `examples/README.md` documents (`npm install /path/to/signals-node` then `npm install @modelcontextprotocol/sdk express zod` from the registry): identical result, so the README's instructions are sufficient. `examples/python/server.py` under uvicorn: `add(2,3)` → `5.0` and the same five event types recorded, `source.sdk=python`, `server_name=signals-python-example`. |
| 5 — `backend-qa.mjs` / `spec-qa.mjs` batches spec-valid, expectations match `ingest.openapi.yaml` | **Pass.** `reports/review-r1/backend-qa-batch-probe.mjs` lifts the `uuid7`, `envelope`, `first`, `events` and `liveEvent` lines out of the shipped script and validates what they build: the 25-event batch and the live batch both satisfy `batch.schema.json` and `events.schema.json`. Posted to the reference collector: first `202 accepted=25 rejected=[]`, replay `202 accepted=25`, 25 lines stored — exactly the assertions the script now makes. The changed replay expectation (`accepted === events.length`, was `0`) is what `ingest.openapi.yaml:53` requires ("already-stored events (same `ts` and `id`) count as accepted") and matches the `IngestResult` `{accepted, rejected}` body shape. `spec-qa.mjs` sends no batch; its fixtures are covered below. |
| 6 — demo data | **Pass.** `reports/review-r1/demo-fixture-probe.mjs`: `demo.ts` and `fixture.ts` each serve 40 events covering all ten types; every event validates against `events.schema.json` once the two documented read-model keys are removed, every id matches the UUIDv7 pattern, every `ts` round-trips through `Date.toISOString()`, every type's required attrs are present, and each set posts to the mock collector as `202 accepted=40 rejected=[]`. The shared `source` object satisfies `batch.schema.json` `$defs/source`. |

### Hygiene

`git status --porcelain` is empty apart from this review and its probes, which
are committed in the same commit; `git ls-files reviews reports/review-r1` lists
them. The diff touches nothing under `crates/`, `spec/`, `scripts/`, `.sqlx/`,
`xtask/`, `docker/`, `bench/` or `.github/`. Every server I started (ports
23330–23366) is stopped; nothing was pushed or published, and neither SDK
checkout nor the spec checkout was modified (`npm ci` in signals-node was
replaced by a read-only `npm ls --depth=0`, which shows the lockfile's exact
versions already installed, and `uv sync` by its `--dry-run`).

## Probes committed

`reports/review-r1/` (see its `README.md` for how to run each one):

- `setup-snippets-probe.mjs` — captures the three Setup snippets from the live
  demo UI and validates/posts the raw-HTTP batch.
- `node-sdk-probe.mjs` — runs the Setup Node snippet and `examples/node/server.mjs`
  end to end into the spec's mock collector.
- `setup_python_snippet_probe.py` — runs the Setup Python snippet under uvicorn.
- `python_example_probe.py` — runs `examples/python/server.py` end to end.
- `backend-qa-batch-probe.mjs` — validates the batches `web/scripts/backend-qa.mjs`
  builds and checks its 202/replay expectations against the reference collector.
- `demo-fixture-probe.mjs` — validates `demo.ts` and `fixture.ts` against the spec.
- `field-audit-probe.mjs` — the field-level audit; **this one fails only if a
  non-spec field is read**, so it passes today and will catch a regression.

None of the probes assert S1 (adding a failing test for an optional type key
would wedge the field audit), so S1 is reported by inspection plus the recorded
SDK traffic above.
