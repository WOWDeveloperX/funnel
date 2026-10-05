import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // API port is pinned separately from PORT so tooling that sets PORT for vite doesn't collide
      '/api': `http://localhost:${process.env.API_PORT ?? 3000}`,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
