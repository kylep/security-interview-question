import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Ultra-open dev server so anyone on the network can poke at it.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false
      }
    }
  }
});
