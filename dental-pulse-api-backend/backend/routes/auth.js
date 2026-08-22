const express = require('express');
const rateLimit = require('express-rate-limit');
const supabase = require('../config/supabase');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' },
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return res.status(401).json({ error: error.message });
    }

    // Check superadmin role
    const { data: profile, error: profileError } = await supabase
      .from('superadmins')
      .select('role, full_name, avatar_url')
      .eq('id', data.user.id)
      .single();

    if (profileError || profile?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Access denied. Superadmin only.' });
    }

    return res.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        full_name: profile.full_name,
        avatar_url: profile.avatar_url,
        role: profile.role,
      },
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/logout
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    await supabase.auth.admin.signOut(token);
    return res.json({ message: 'Logged out successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Logout failed' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { data: profile } = await supabase
      .from('superadmins')
      .select('role, full_name, avatar_url')
      .eq('id', req.user.id)
      .single();

    return res.json({
      id: req.user.id,
      email: req.user.email,
      full_name: profile?.full_name,
      avatar_url: profile?.avatar_url,
      role: profile?.role,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to get user info' });
  }
});

module.exports = router;
