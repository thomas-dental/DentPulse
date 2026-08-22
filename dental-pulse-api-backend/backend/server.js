require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

// Prevent unhandled promise rejections from crashing the server
// (e.g. transient Supabase SSL errors, Cloudflare 525, network blips)
process.on('unhandledRejection', (reason) => {
  const summary = String(reason?.message || reason).substring(0, 200).replace(/\n/g, ' ');
  console.error('[Server] Unhandled promise rejection (server kept alive):', summary);
});

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception (server kept alive):', err.message);
});

const swaggerUi = require('swagger-ui-express');
const { swaggerSpec } = require('./config/swagger');
const { startCashflowThresholdCron } = require('./services/cashflowThresholdCron');
const { startAiForecastCron } = require('./services/aiForecastCron');
const { startAutoSyncCron } = require('./services/autoSyncCron');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const userRoutes = require('./routes/users');
const organizationRoutes = require('./routes/organizations');
const syncRoutes = require('./routes/sync');
const iplicitSyncRoutes = require('./routes/iplicitSync');
const iplicitInvoiceRoutes = require('./routes/iplicitInvoice');
const xeroSyncRoutes   = require('./routes/xeroSync');
const sageRoutes       = require('./routes/sageSync');
const quickbooksSyncRoutes = require('./routes/quickbooksSync');
const settingsRoutes = require('./routes/settings');
const onboardRoutes = require('./routes/onboard');
const inboundEmailRoutes = require('./routes/inboundEmail');
const adminPanelRoutes = require('./routes/adminPanel');
const profileSyncRoutes = require('./routes/profileSync');
const passwordSyncRoutes = require('./routes/passwordSync');
const passwordBroadcastRoutes = require('./routes/passwordBroadcast');
const roleSyncRoutes = require('./routes/roleSync');
const internalPropagatedRoleRoutes = require('./routes/internalPropagatedRole');
const provisioningRoutes = require('./routes/provisioning');
const registerBroadcastRoutes = require('./routes/registerBroadcast');
const setPasswordRoutes = require('./routes/setPassword');
const checkUserRoutes = require('./routes/checkUser');
// DISABLED: already run, commented to prevent accidental use
// const resetAllPasswordsRoutes = require('./routes/resetAllPasswords');
const chatbotRoutes = require('./routes/chatbot');
const cashflowForecastRoutes = require('./routes/cashflowForecast');
const syncModule = require('./queue');
const syncSettingsStore = require('./services/sync/settingsStore');

const app = express();
const PORT = process.env.PORT || 5000;

// app.use(helmet());
app.use(helmet({
  contentSecurityPolicy: false,
  frameguard: false,
}));

// Allowed origins for CORS (localhost dev + LAN dev + DentPulse hosted frontends)
const ALLOWED_ORIGINS = [
  /^http:\/\/localhost:\d+$/,
  /^http:\/\/127\.0\.0\.1:\d+$/,
  /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:\d+$/,
  /^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/,
  /^https:\/\/[\w-]+\.dentpulse\.(com|ai)$/,
  'https://dental-pulse-dev-tzw1.vercel.app',
  ...(process.env.CORS_ALLOWED_ORIGINS ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(o => o.trim()) : []),
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    for (const allowed of ALLOWED_ORIGINS) {
      if (allowed instanceof RegExp ? allowed.test(origin) : allowed === origin) {
        return callback(null, true);
      }
    }
    console.warn('[CORS] Blocked origin:', origin);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// JSON parser - skip for inbound-email-webhook (handled separately with higher limit)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/inbound-email-webhook')) {
    return next();
  }
  // Chatbot accepts image attachments — needs a larger payload than other routes.
  if (req.path.startsWith('/api/chatbot')) {
    return express.json({ limit: '25mb' })(req, res, next);
  }
  // Default: 5mb + rawBody capture so password-sync can HMAC-verify the payload.
  express.json({
    limit: '5mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })(req, res, next);
});

// Swagger API docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/users', userRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/sync', syncRoutes);               // Dentally sync
app.use('/api/iplicit-sync', iplicitSyncRoutes);       // Iplicit sync
app.use('/api/iplicit-invoice', iplicitInvoiceRoutes); // Iplicit invoice operations
app.use('/api/xero-sync', xeroSyncRoutes);             // Xero sync
app.use('/api/sage', sageRoutes);                      // Sage Business Cloud Accounting (OAuth only — Phase 1)
app.use('/api/quickbooks-sync', quickbooksSyncRoutes); // QuickBooks sync
app.use('/api/settings', settingsRoutes);
app.use('/api/onboard', onboardRoutes);        // Dentally onboarding
app.use('/api/inbound-email-webhook', express.json({ limit: '50mb' }), inboundEmailRoutes); // Inbound email processing (large payload)
app.use('/api/admin-panel', adminPanelRoutes);   // Admin panel (cross-project user listing)
app.use('/api/profile-sync', profileSyncRoutes); // Profile sync from Central Auth
app.use('/api/password-sync', passwordSyncRoutes); // Password sync from Central Auth
app.use('/api/password-broadcast', passwordBroadcastRoutes); // Password broadcast from DentPulse Frontend
app.use('/api/role-sync', roleSyncRoutes); // RBAC sync from DentPulse Frontend → Central Auth
app.use('/api/internal/propagated-role', internalPropagatedRoleRoutes); // Inbound from Central Auth — role propagation
app.use('/api/provision-user', provisioningRoutes);          // Cross-platform user provisioning
app.use('/api/register-broadcast', registerBroadcastRoutes); // Register new user in Central Auth
app.use('/api/set-password', setPasswordRoutes);             // Set password for provisioned users (first-login)
app.use('/api/auth/check-user', checkUserRoutes);            // Check user status before login
app.use('/api/check-duplicate', require('./routes/checkDuplicate')); // Pre-signup duplication check
app.use('/api/team', require('./routes/teamBatchInvite'));           // Batch team member invite (onboarding)
// DISABLED: already run, commented to prevent accidental use
// app.use('/api/dev/reset-all-passwords', resetAllPasswordsRoutes);
app.use('/api/chatbot', chatbotRoutes);           // Chatbot V1/V2 unified endpoint
app.use('/api/cashflow-forecast', cashflowForecastRoutes); // 13-week cash flow AI (grounded) prediction
app.use('/api/ai-usage', require('./routes/aiUsage')); // Admin: AI token usage per user
app.use('/api/ai-key', require('./routes/aiKey'));     // Resolve per-user/tenant Anthropic key for client-side AI features
app.use('/api/plaid', require('./routes/plaid'));          // Plaid open banking (onboarding, connections, statements)
app.use('/api/module-access', require('./routes/moduleAccess')); // Module access (default + per-org module enable/disable)

// Serve AP-Invoices folder for PDF files
app.use('/AP-Invoices', express.static(path.join(__dirname, 'AP-Invoices')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);

  // Load sync settings from the DB before any queue initialises — the queues
  // read them synchronously and there is no file fallback, so priming the
  // cache here keeps the first job from running on built-in defaults.
  try {
    await syncSettingsStore.refresh();
  } catch (err) {
    console.error('Failed to load sync settings from DB:', err.message);
  }

  // Initialize Dentally queue (recover incomplete jobs)
  try {
    await syncModule.initialize();
  } catch (err) {
    console.error('Failed to initialize Dentally sync queue:', err.message);
  }

  // Initialize Iplicit queue (recover incomplete jobs)
  try {
    await syncModule.iplicit.initialize();
  } catch (err) {
    console.error('Failed to initialize Iplicit sync queue:', err.message);
  }

  // Initialize Xero queue (recover incomplete jobs)
  try {
    await syncModule.xero.initialize();
  } catch (err) {
    console.error('Failed to initialize Xero sync queue:', err.message);
  }

  // Initialize QuickBooks queue (recover incomplete jobs)
  try {
    await syncModule.quickbooks.initialize();
  } catch (err) {
    console.error('Failed to initialize QuickBooks sync queue:', err.message);
  }

  // Daily cash-flow threshold alert (08:00 Europe/London by default) — reads the
  // breach status the forecast page persists and raises one alert per user per day.
  try {
    startCashflowThresholdCron();
  } catch (err) {
    console.error('Failed to start cash-flow threshold cron:', err.message);
  }

  // Twice-daily (07:00 / 19:00 Europe/London) AI cash-flow forecast refresh — reads
  // the baseline the forecast page persists and stores Claude's adjusted numbers so
  // the page shows a ready AI forecast on open. Never blocks startup.
  try {
    startAiForecastCron();
  } catch (err) {
    console.error('Failed to start AI forecast cron:', err.message);
  }

  // After-close auto-sync: every 15 min, checks each Dentally org's closing
  // time (practice_locations.operating_hours) and triggers one incremental
  // sync per org per day once the last site has closed. Picks up records
  // created or updated in the last few days via the entities' own
  // created_after/updated_after filters.
  try {
    startAutoSyncCron();
  } catch (err) {
    console.error('Failed to start auto-sync cron:', err.message);
  }
});
