FROM node:24-bookworm-slim AS web
WORKDIR /build/web
COPY LICENSE /build/LICENSE
COPY web/package*.json ./
COPY web/apps/dashboard/package.json apps/dashboard/package.json
COPY web/packages/ui/package.json packages/ui/package.json
RUN npm ci --no-audit --no-fund
COPY web/ ./
COPY README.md /build/README.md
COPY docs/ /build/docs/
COPY bench/README.md /build/bench/README.md
COPY examples/README.md /build/examples/README.md
COPY spec/README.md /build/spec/README.md
RUN npm run build

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
