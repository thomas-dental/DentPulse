const express = require('express');
const router = express.Router();
const syncAuthMiddleware = require('../middleware/syncAuth');
const requireUserAiKey = require('../middleware/requireUserAiKey');
const { predictForecast } = require('../services/cashflowForecastPredict');

// 13-Week Cash Flow Forecast — AI (grounded) prediction.
//
// The prompt, schema and sanitiser now live in services/cashflowForecastPredict.js so
// this route and the twice-daily aiForecastCron share ONE implementation and cannot
// drift apart. This handler is only request plumbing.

// POST /api/cashflow-forecast/predict
router.post('/predict', syncAuthMiddleware, requireUserAiKey, async (req, res) => {
  try {
    const { organizationId, locationLabel, period, weeks, rows } = req.body || {};
    const result = await predictForecast({
      organizationId,
      locationLabel,
      period,
      weeks,
      rows,
      userId: req.user?.id || null,
    });
    res.json(result);
  } catch (err) {
    console.error('[CASHFLOW-FORECAST-AI] predict error:', err?.message);
    // predictForecast marks input/upstream problems with .status; NO_API_KEY is a
    // configuration problem the user can act on, so it stays a 400.
    const status = err?.status || (err?.code === 'NO_API_KEY' ? 400 : 500);
    res.status(status).json({ error: err?.message || 'Failed to generate AI forecast' });
  }
});

module.exports = router;
