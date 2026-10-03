FROM oven/bun:1.4.2 AS web
WORKDIR /build/web
COPY LICENSE /build/LICENSE
COPY web/package.json web/bun.lock ./
COPY web/apps/dashboard/package.json apps/dashboard/package.json
COPY web/packages/ui/package.json packages/ui/package.json
RUN bun install --frozen-lockfile
COPY web/ ./
RUN bun run build

FROM rust:1.99.0-bookworm AS rust
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY .sqlx/ .sqlx/
COPY .cargo/ .cargo/
COPY xtask/ xtask/
COPY crates/ crates/
COPY spec/ spec/
COPY --from=web /build/web/dist/ web/dist/
RUN cargo build --locked --release --bin signals

FROM gcr.io/distroless/cc-debian12:nonroot
COPY LICENSE /LICENSE
COPY --from=rust /build/target/release/signals /signals
EXPOSE 8300
ENTRYPOINT ["/signals"]
CMD ["serve"]
