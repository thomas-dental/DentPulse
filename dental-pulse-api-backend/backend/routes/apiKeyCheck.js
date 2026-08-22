const express = require('express');
const router = express.Router();

// POST /api/check-api-key/anthropic — proxy a test request to Anthropic API
router.post('/anthropic', async (req, res) => {
  const { api_key } = req.body || {};

  if (!api_key) {
    return res.status(400).json({ error: 'api_key is required' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': api_key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 20,
        messages: [{ role: 'user', content: 'Say "OK" only.' }],
      }),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    console.error('[ApiKeyCheck] Error:', error.message);
    return res.status(500).json({ error: 'Failed to reach Anthropic API' });
  }
});

module.exports = router;
