import { defineConfig } from 'vite';

// `base` is overridden in CI so the build works from a GitHub Pages sub-path
// (https://<user>.github.io/<repo>/) as well as from the root of any host.
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    port: 5173,
    host: true,
  },
});
