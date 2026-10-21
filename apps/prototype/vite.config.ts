import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Relative base so the built app works from any static location (file share, artifact, sub-path).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
});
