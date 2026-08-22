const supabase = require('../config/supabase');

const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Check superadmin role
    const { data: profile, error: profileError } = await supabase
      .from('superadmins')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profileError || profile?.role !== 'superadmin') {
      return res.status(403).json({ error: 'Access denied. Superadmin only.' });
    }

    req.user = user;
    req.profile = profile;
    req.accessToken = token;
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

module.exports = authMiddleware;
