import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Relative base so the built app works from any static location (file share, artifact, sub-path).
// Pages are lazy chunks (see the shell); React and the platform engine get chunks of their own, so
// a rebuild that changes only pages leaves those two files, and their names, as they were.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'engine', test: /[\\/]src[\\/](engine|domain)[\\/]|node_modules[\\/](immer|@noble)[\\/]/ },
          ],
        },
      },
    },
  },
});
