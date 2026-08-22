const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// GET /api/dashboard/stats
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const [usersResult, appointmentsResult, patientsResult] = await Promise.all([
      supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('appointments').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('patients').select('id', { count: 'exact', head: true }),
    ]);

    return res.json({
      total_users: usersResult.count || 0,
      total_appointments: appointmentsResult.count || 0,
      total_patients: patientsResult.count || 0,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

module.exports = router;
