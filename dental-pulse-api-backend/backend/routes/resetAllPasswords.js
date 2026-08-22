/**
 * Reset ALL user passwords to 123456 in DentPulse (Supabase)
 *
 * GET /api/dev/reset-all-passwords
 */
const express = require('express');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const newPassword = '123456';
    let updated = 0;
    let page = 1;
    const perPage = 50;

    while (true) {
      const listResult = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      const error = listResult?.error;
      const users = listResult?.data?.users;

      if (error) {
        return res.status(500).json({ success: false, error: error.message });
      }

      if (!users || users.length === 0) break;

      for (const user of users) {
        const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password: newPassword });
        if (!updateErr) updated++;
      }

      if (users.length < perPage) break;
      page++;
    }

    res.json({
      success: true,
      data: {
        platform: 'DentPulse Enterprise',
        password: newPassword,
        users_updated: updated,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
