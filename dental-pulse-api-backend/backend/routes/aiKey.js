const express = require('express');
const router = express.Router();
const syncAuthMiddleware = require('../middleware/syncAuth');
const requireUserAiKey = require('../middleware/requireUserAiKey');
const { getOrgApiKey } = require('../services/chatbot/apiKeyService');

// GET /api/ai-key
//
// Returns the resolved Anthropic key for the authenticated user, so client-side
// AI features can source it from the backend instead of a baked-in
// VITE_ANTHROPIC_API_KEY. requireUserAiKey resolves and pins the key first:
//   - the user's own enabled key, else
//   - their tenant owner's enabled key,
//   - otherwise 403 (never a key).
// So a user without AI access can never obtain a key here.
router.get('/', syncAuthMiddleware, requireUserAiKey, async (req, res) => {
  try {
    // requireUserAiKey has pinned the per-user / tenant key into the async
    // context; getOrgApiKey returns exactly that for an interactive request.
    const { apiKey } = await getOrgApiKey(req.query.organizationId || null);
    if (!apiKey) return res.status(403).json({ error: 'No AI key available' });
    return res.json({ apiKey });
  } catch (err) {
    const status = err?.code === 'NO_API_KEY' ? 403 : 500;
    return res.status(status).json({ error: err?.message || 'Failed to resolve AI key' });
  }
});

module.exports = router;
