import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Backend target: local dev server or production
const BACKEND_TARGET = process.env.VITE_SYNC_BACKEND_URL || 'http://localhost:4000';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      '/api/sync': {
        target: BACKEND_TARGET,
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            proxyReq.removeHeader('origin');
            console.log(`[Vite Proxy] ${req.method} ${req.url} -> ${proxyReq.protocol}//${proxyReq.host}${proxyReq.path}`);
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            console.log(`[Vite Proxy] ${proxyRes.statusCode} <- ${req.method} ${req.url}`);
          });
          proxy.on('error', (err, req) => {
            console.error(`[Vite Proxy] Error for ${req.method} ${req.url}:`, err.message);
          });
        },
      },
      '/api/onboard': {
        target: BACKEND_TARGET,
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin');
          });
        },
      },
      '/api/iplicit-sync': {
        target: BACKEND_TARGET,
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin');
          });
        },
      },
      '/api/iplicit-invoice': {
        target: BACKEND_TARGET,
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin');
          });
        },
      },
      // Per-user/tenant Anthropic key for client-side AI features
      // (AI Insights, priority tips, buyer questions — src/lib/aiKey.ts)
      '/api/ai-key': {
        target: BACKEND_TARGET,
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin');
          });
        },
      },
      // Usage reporting for client-side AI features (src/lib/aiUsageLog.ts)
      '/api/ai-usage': {
        target: BACKEND_TARGET,
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin');
          });
        },
      },
      '/api/chatbot': {
        target: BACKEND_TARGET,
        changeOrigin: true,
        secure: false,
        // Chat answers (esp. dashboards with tool round-trips) can take a
        // while. Give the proxy a generous window before it gives up on the
        // upstream so a slow-but-valid generation isn't cut off.
        timeout: 180000,
        proxyTimeout: 180000,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin');
          });
          // The Node backend runs under `node --watch`, so saving a backend
          // file restarts it and kills any in-flight chat request. Without
          // this handler http-proxy just resets the socket and the browser
          // fetch dies with a cryptic "Failed to fetch" + a bare Vite log.
          // Instead, return a clean JSON 504 — useChatbot.ts renders
          // `errorData.error` as an assistant message, so the user sees an
          // actionable note and can simply resend.
          proxy.on('error', (err, req, res) => {
            const code = (err as NodeJS.ErrnoException).code || '';
            const restarted = code === 'ECONNRESET' || code === 'ECONNREFUSED';
            console.error(`[Vite Proxy] /api/chatbot error for ${req.method} ${req.url}: ${code || err.message}`);
            const sres = res as import('http').ServerResponse;
            if (!sres || sres.headersSent || sres.writableEnded) return;
            sres.writeHead(504, { 'Content-Type': 'application/json' });
            sres.end(JSON.stringify({
              error: restarted
                ? 'The assistant backend restarted (likely a backend code change) and dropped this request. Please resend your message.'
                : 'The assistant backend did not respond in time. Please try again in a moment.',
              errorCode: 'BACKEND_UNREACHABLE',
            }));
          });
        },
      },
      '/api/cashflow-forecast': {
        target: BACKEND_TARGET,
        changeOrigin: true,
        secure: false,
        // The grounded AI prediction is a reasoning-heavy Claude call — give the
        // proxy a generous window so a slow-but-valid generation isn't cut off.
        timeout: 180000,
        proxyTimeout: 180000,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin');
          });
          // Backend runs under `node --watch`; a restart mid-request would
          // otherwise reset the socket. Return a clean JSON 504 so the hook can
          // show an actionable message instead of a cryptic "Failed to fetch".
          proxy.on('error', (err, req, res) => {
            const code = (err as NodeJS.ErrnoException).code || '';
            const restarted = code === 'ECONNRESET' || code === 'ECONNREFUSED';
            console.error(`[Vite Proxy] /api/cashflow-forecast error for ${req.method} ${req.url}: ${code || err.message}`);
            const sres = res as import('http').ServerResponse;
            if (!sres || sres.headersSent || sres.writableEnded) return;
            sres.writeHead(504, { 'Content-Type': 'application/json' });
            sres.end(JSON.stringify({
              error: restarted
                ? 'The forecasting backend restarted and dropped this request. Try again in a moment.'
                : 'The forecasting backend did not respond in time. Please try again.',
              errorCode: 'BACKEND_UNREACHABLE',
            }));
          });
        },
      },
      '/api/inbound': {
        target: 'https://inbound.new',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/inbound/, '/api/e2'),
        secure: true,
      },
      // OpenAI proxy to avoid CORS issues
      '/openai-api': {
        target: 'https://api.openai.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/openai-api/, ''),
        secure: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin');
          });
        },
      },
      // Anthropic proxy to avoid CORS issues
      '/anthropic-api': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/anthropic-api/, ''),
        secure: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin');
          });
        },
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
