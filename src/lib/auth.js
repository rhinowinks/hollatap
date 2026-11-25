const { db } = require('../db');
const config = require('../config');
const { isFuture } = require('./util');

async function loadUser(req, res, next) {
  res.locals.user = null;
  const id = req.session && req.session.uid;
  if (id) {
    const user = await db('users').where({ id }).first();
    if (user) {
      req.user = user;
      res.locals.user = user;
      // refresh last seen at most hourly
      if (!user.last_seen_at || Date.now() - new Date(user.last_seen_at).getTime() > 3600e3) {
        await db('users').where({ id }).update({ last_seen_at: new Date(), deletion_warned_at: null });
      }
    } else {
      req.session = null;
    }
  }
  next();
}

function requireUser(req, res, next) {
  if (!req.user) {
    req.session.next = req.originalUrl;
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !isAdmin(req.user)) return res.status(404).render('error', { title: 'Not found', message: 'Page not found.' });
  next();
}

function isAdmin(user) {
  return !!user && (user.is_admin || config.adminEmails.includes(user.email));
}

// Effective plan: pro if paid & unexpired or in trial; team if member of a paid team.
async function effectivePlan(user) {
  if (!user) return 'free';
  if (user.team_id) {
    const team = await db('teams').where({ id: user.team_id }).first();
    if (team && isFuture(team.paid_until)) return 'team';
  }
  if (user.plan === 'pro' && isFuture(user.plan_expires_at)) return 'pro';
  if (isFuture(user.trial_ends_at)) return 'pro';
  return 'free';
}

function limitsFor(plan) {
  return config.limits[plan] || config.limits.free;
}

module.exports = { loadUser, requireUser, requireAdmin, isAdmin, effectivePlan, limitsFor };
