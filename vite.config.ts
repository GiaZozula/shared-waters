import { defineConfig, loadEnv } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { apiOrigin } from './shared/api-origin.js';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiBase = apiOrigin(env.VITE_API_BASE ?? '');
  let outputDirectory = '';
  return {
  plugins: [
    {
      name: 'static-api-security-headers',
      apply: 'build',
      configResolved(config) { outputDirectory = resolve(config.root, config.build.outDir); },
      async closeBundle() {
        const template = await readFile(resolve('public/_headers'), 'utf8');
        await writeFile(resolve(outputDirectory, '_headers'), template.replaceAll('__API_CONNECT_SRC__', apiBase));
      },
    },
    {
      name: 'system-page-route',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const path = req.url?.split('?')[0];
          if (['/status', '/status/', '/status.html'].includes(path ?? '')) {
            res.writeHead(302, { Location: '/system' });
            res.end();
            return;
          }
          if (path === '/system' || path === '/system/') {
            const query = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
            req.url = `/system.html${query}`;
          }
          next();
        });
      },
    },
  ],
  build: {
    rollupOptions: {
      input: {
        main: new URL('./index.html', import.meta.url).pathname,
        system: new URL('./system.html', import.meta.url).pathname,
      },
    },
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
  };
});
