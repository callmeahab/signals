import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: { port: 3300, strictPort: true, proxy: { '/v1': 'http://127.0.0.1:8300' } },
  build: { outDir: '../../dist', emptyOutDir: true },
});
