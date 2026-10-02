# @mcpramen/signals-ui

Apache-2.0 React screens for Signals: Overview, Tools, Callers, Sessions, Live, Settings and Setup. React 18.3/19 and lucide-react are peer dependencies. The package includes compiled ESM and TypeScript declarations; it is prepared for publishing but has not been published.

```tsx
'use client';
import { SignalsDashboard, type SignalsClient } from '@mcpramen/signals-ui';
import '@mcpramen/signals-ui/styles.css';
// import '@mcpramen/signals-ui/theme.css'; // optional default Live Signal theme
```

Pass a `SignalsClient`, `project`, `screen`, `range`, `onNavigate` and `onProjectChange` to `SignalsDashboard`; use `readOnly` for viewers. The host owns routing, login, project selection and HTTP/SSE. The component package never fetches directly. The adapter must return `Page<SignalEvent>` for session history and honor its cursor; tool/caller chart methods return dense UTC points. `ingestUrl` supplies the deployment URL for Setup.

`styles.css` is scoped to `.signals-ui`. It does not reset the host body or overwrite its color tokens. Supply the existing mcpflux variables (`--background`, `--foreground`, `--card`, `--primary`, `--border`, `--muted-foreground`, `--chart-1`…`--chart-5`, etc.) and fonts (`--font-sans`, `--font-heading`, `--font-mono`), or import the optional `theme.css`. Dark mode follows the host's `.dark` class. Dialogs stay inside the component tree.

See `examples/next-host` for a Next.js App Router smoke host. It consumes the packed tarball, rather than aliasing source files. `web/apps/dashboard/src/client.ts` is the real cookie/HTTP/SSE adapter; backend credentials should remain in a host adapter or server proxy. The official SDK snippets are pending Plan 1, as documented in the collector's spec manifest.

Build and inspect from `web`: `npm run build:ui` then `npm pack --workspace @mcpramen/signals-ui --dry-run`.
