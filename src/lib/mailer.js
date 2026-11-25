const nodemailer = require('nodemailer');
const config = require('../config');

let transport = null;
if (config.mailEnabled) {
  transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
}

const sentLog = []; // kept in memory in dev for tests

function wrap(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#FAF6F0;font-family:Arial,sans-serif;color:#0F1B2D">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;padding:32px">
<tr><td><img src="${config.baseUrl}/brand/email-logo.png" alt="HollaTap" width="180" style="display:block;border:0;height:auto;margin-bottom:24px"></td></tr>
<tr><td style="font-size:16px;line-height:26px">
<h1 style="font-size:22px;margin:0 0 12px">${title}</h1>${bodyHtml}
</td></tr>
<tr><td style="padding-top:24px;font-size:12px;color:#5B6573">HollaTap, a Rhinowinks product · <a href="${config.baseUrl}/privacy" style="color:#C2410C">Privacy</a></td></tr>
</table></td></tr></table></body></html>`;
}

async function send({ to, subject, title, html, text }) {
  const msg = { from: config.smtp.from, to, subject, html: wrap(title || subject, html), text };
  sentLog.push({ to, subject, text, at: new Date() });
  if (sentLog.length > 200) sentLog.shift();
  if (!transport) {
    console.log(`[mail:dev] to=${to} subject="${subject}"\n${text || ''}`);
    return { dev: true };
  }
  return transport.sendMail(msg);
}

module.exports = { send, sentLog };
