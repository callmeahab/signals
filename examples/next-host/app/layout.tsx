import type { ReactNode } from 'react';
import '@mcpramen/signals-ui/theme.css';
import '@mcpramen/signals-ui/styles.css';
import './host.css';
export const metadata={title:'Signals Next.js host smoke test'};
export default function Layout({children}:{children:ReactNode}) {return <html lang="en"><body><header className="host-banner">mcpflux host · Signals package smoke test</header><main>{children}</main></body></html>;}
