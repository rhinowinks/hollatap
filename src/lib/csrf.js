const crypto = require('crypto');

const MULTIPART_ROUTES = [/^\/cards$/, /^\/cards\/\d+$/, /^\/teams\/settings$/, /^\/teams\/invite$/];

function reject(res) {
  return res.status(403).render('error', { title: 'Please try again', message: 'Your session expired. Go back, refresh the page and try again.' });
}

// Session-bound CSRF token for all state-changing requests.
// Multipart forms are checked after multer has parsed them (see `after`).
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(18).toString('base64url');
  res.locals.csrf = req.session.csrf;
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    if (req.path.startsWith('/webhooks/')) return next();
    if (/^multipart\/form-data/i.test(req.get('content-type') || '')) {
      // Only routes that parse uploads (and then call csrf.after) accept multipart bodies.
      if (!MULTIPART_ROUTES.some((re) => re.test(req.path))) return reject(res);
      req.csrfPending = true;
      return next();
    }
    const sent = (req.body && req.body._csrf) || req.get('x-csrf-token');
    if (!sent || sent !== req.session.csrf) return reject(res);
  }
  next();
}

csrf.after = function (req, res, next) {
  if (!req.csrfPending) return next();
  const sent = req.body && req.body._csrf;
  if (!sent || sent !== req.session.csrf) return reject(res);
  req.csrfPending = false;
  next();
};

module.exports = csrf;
