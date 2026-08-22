import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  envDir: '..',  // Load .env from parent directory (root)
  build: {
    chunkSizeWarningLimit: 1000, // antd is ~232 kB gzipped — acceptable
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'antd-vendor': ['antd', 'dayjs'],
          'ui-vendor': ['lucide-react', 'sonner', 'sweetalert2'],
        },
      },
    },
  },
})
