# Next.js package smoke host

Uses the same Next 16.3.3 / React 19.2.8 versions as mcpflux's web app, its Live Signal tokens, and the compiled package exports. This is an isolated integration fixture for C3; Plan 3 platform routing and billing remain outside this collector.

From `web`, run `npm run build:ui && npm pack --workspace @mcpramen/signals-ui --pack-destination /tmp`. Then in this directory install that tarball (`npm install /tmp/mcpramen-signals-ui-0.1.0.tgz`), `npm run build`, and `npm start`. The committed dependency uses the local compiled package; CI replaces it with the packed tarball to catch missing exports/assets. Data is an explicit in-memory demo fixture. No backend credentials are bundled.
