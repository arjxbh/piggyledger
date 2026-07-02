function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  next();
}

function requireAdult(req, res, next) {
  if (!req.session.userId || req.session.role !== 'adult') {
    return res.status(403).json({ error: 'Adults only' });
  }
  next();
}

module.exports = { requireLogin, requireAdult };
