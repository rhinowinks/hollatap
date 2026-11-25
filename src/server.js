const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieSession = require('cookie-session');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { db, migrate } = require('./db');
const { loadUser, isAdmin } = require('./lib/auth');
const csrf = require('./lib/csrf');
const { seedPromos } = require('./lib/promos');
const { naira } = require('./lib/util');
const jobs = require('./jobs');

const app = express();
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", 'https://challenges.cloudflare.com'],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:', 'blob:'],
        'connect-src': ["'self'"],
        'frame-src': ['https://challenges.cloudflare.com'],
        'worker-src': ["'self'", 'blob:'],
        'form-action': ["'self'", 'https://checkout.paystack.com'],
        'upgrade-insecure-requests': config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

// Paystack webhook needs the raw body for signature checks — mount before body parsers.
app.use('/webhooks', require('./routes/webhooks'));

app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(express.json({ limit: '200kb' }));
app.use(
  cookieSession({
    name: 'ht_sess',
    keys: [config.sessionSecret],
    maxAge: 30 * 24 * 3600 * 1000,
    sameSite: 'lax',
    httpOnly: true,
    secure: config.isProd,
  })
);
app.use('/', express.static(path.join(__dirname, '..', 'public'), { maxAge: config.isProd ? '7d' : 0 }));

// Capture referral codes (?ref=XXXX) for 30 days.
app.use((req, res, next) => {
  if (req.query.ref && /^[A-Z0-9]{4,16}$/i.test(req.query.ref) && !req.session.uid) {
    req.session.ref = String(req.query.ref).toUpperCase();
  }
  next();
});

app.use((req, res, next) => {
  res.locals.config = config;
  res.locals.naira = naira;
  res.locals.path = req.path;
  res.locals.flash = req.session.flash || null;
  if (req.session.flash) delete req.session.flash;
  next();
});
app.use((req, res, next) => loadUser(req, res, next).catch(next));
app.use((req, res, next) => {
  res.locals.isAdmin = isAdmin(req.user);
  next();
});
app.use(csrf);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.env === 'test' ? 500 : 20, standardHeaders: true, legacyHeaders: false, skip: (req) => req.method !== 'POST' });
app.use(['/login', '/verify'], authLimiter);

app.get('/health', (req, res) => res.json({ ok: true }));
app.use(require('./routes/auth'));
app.use(require('./routes/pay'));
app.use(require('./routes/dashboard'));
app.use(require('./routes/teams'));
app.use(require('./routes/admin'));
app.use(require('./routes/public')); // last: contains /:slug

app.use((req, res) => res.status(404).render('error', { title: 'Not found', message: 'That page does not exist.' }));
app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).render('error', { title: 'File too large', message: 'Logos must be under 3 MB. Go back and choose a smaller file.' });
  }
  res.status(500).render('error', { title: 'Something went wrong', message: 'Please try again. If it keeps happening, email ' + config.supportEmail + '.' });
});

async function start() {
  await migrate();
  await seedPromos();
  // Ensure admin emails are flagged as admin
  if (config.adminEmails.length) await db('users').whereIn('email', config.adminEmails).update({ is_admin: true });
  jobs.start();
  return app.listen(config.port, () => console.log(`HollaTap running on ${config.baseUrl} (port ${config.port})`));
}

if (require.main === module) {
  start().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { app, start };
