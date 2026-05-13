import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "/shelving-hub/",
  server: {
    proxy: {
      // Local dev: proxy /api → api.anthropic.com (no CORS, headers forwarded as-is)
      "/api": {
        target: "https://api.anthropic.com",
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api/, ""),
        secure: true,
      },
    },
  },
})
