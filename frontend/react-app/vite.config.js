import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Where the ExamPro backend runs while developing.
  const backend = env.VITE_PROXY_TARGET || 'http://localhost:5000';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // The browser talks to /api on THIS server (same origin), and Vite forwards it to the backend. That way
      // the HttpOnly refresh cookie works without any change to the backend's CORS settings.
      proxy: {
        '/api': {
          target: backend,
          changeOrigin: true,
          configure: (proxy) => {
            // The backend only accepts browser requests from origins on its CORS allow-list. Requests that arrive
            // through this proxy are server-to-server, so drop the Origin header (development only).
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.removeHeader('origin');
            });
          },
        },
      },
    },
  };
});
