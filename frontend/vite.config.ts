import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: { manualChunks: { cytoscape: ['cytoscape', 'cytoscape-dagre'] } },
    },
  },
  test: { environment: 'jsdom' },
});
