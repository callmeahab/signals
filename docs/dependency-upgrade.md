# Dependency upgrade — 2026-10-02

## Versions

- PostgreSQL: 16.15 → 18.6, with a logical dump/restore into a new volume. PostgreSQL 19 is still beta.
- Rust: 1.98.1 → 1.99.0; the repository, Docker build and CI use the same toolchain.
- Node: Docker and CI use Node 24 LTS. Frontend packages require Node 24 or newer.
- Rust direct dependencies now target their latest stable crates.io releases, including Argon2 0.6.0, rand 0.10.3, SHA-2 0.11.0, HMAC 0.13.0, reqwest 0.13.5, jsonschema 0.58.4, utoipa 6.0.0, syn 3.0.6 and prettyplease 0.3.0. Cargo.lock was regenerated within upstream dependency constraints.
- npm packages use the latest stable npm releases, including React 19.3.0, Vite 8.3.2, its React plugin 6.1.1, ESLint 10.11.0, React Hooks plugin 7.1.1, and the Next.js example 16.3.8.
- TypeScript is pinned to the 6.0 release line (6.0.3). The latest stable compiler is 7.0.2, but typescript-eslint 8.71.0 declares support for `>=4.8.4 <6.1.0`. No peer dependency checks are bypassed. Raise the compiler after the parser supports it.

## Compatibility changes

Argon2 now generates its own salt through the password hashing API; old PHC password hashes remain readable. The updated rand API continues using the operating system's cryptographic random source. HMAC imports its new key initialization trait, and reqwest uses its renamed Rustls feature. Regression tests cover old password hashes, newly generated hashes, invalid passwords and stable HMAC output.

The React Compiler is not enabled. ESLint retains the existing hook ordering and dependency checks while upgrading the plugin, rather than enabling a new compiler ruleset as part of this dependency update.

## Verification

Passed Rust formatting, Clippy with warnings denied, five unit tests, generated wire type checks, SQLx metadata checks, and four PostgreSQL 18 integration/property tests (including 32 randomized lateness cases). Frontend type/lint/production build checks, the seven-screen browser suite, login styles in both themes at 320/390/1440px, the packed Next.js host, collector API/browser checks, and Node/Python MCP examples also passed. npm audit reported zero advisories.

The upgraded Docker image passed two-replica live delivery, immediate revocation, failover, database crash recovery and retry, Prometheus and OTLP checks. In the controlled crash, all 100 acknowledged event IDs survived, and retries converged to 4,000 unique events. These are correctness checks, not a fresh throughput benchmark.

The local `postgres` and `signals` databases were restored using PostgreSQL 18 tools. All 20 table/sequence checks matched, including row counts and digests of every stored row. PostgreSQL 16's `signals_pgdata` volume and the previous application image were retained. Private logical backups and verification reports are in `backups/2026-10-02-pg18/`; the previous Compose configuration is `docker-compose.postgres16.backup`. Both paths are ignored by Git. Use that Compose file with `-p signals` for recovery before new writes; see the migration limitations in [Upgrading](upgrading.md).

[Machine-readable upgrade evidence](evidence/dependency-upgrade.json) records versions and completed checks. Previous capacity measurements in acceptance-evidence.md describe the original PostgreSQL 16 run; they are not PostgreSQL 18 benchmarks.

Registry checks were performed on 2026-10-02. [PostgreSQL releases](https://www.postgresql.org/), [Rust 1.99.0](https://blog.rust-lang.org/2026/10/01/Rust-1.99.0/), and the committed package manifests/lockfiles identify the selected releases.
