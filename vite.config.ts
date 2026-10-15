import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = Number(process.env.GEO_API_PORT ?? 4317);

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  server: {
    port: Number(process.env.PORT ?? 5173),
    proxy: { '/api': `http://127.0.0.1:${apiPort}` },
  },
});
