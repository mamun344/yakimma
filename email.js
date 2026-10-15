// Email settings for the 18+ codes, read from the environment (.env on your own computer, or Render's Environment tab
// for the live site). Used by server.js, and by `npm run email-setup` to check new settings work.
//   SMTP_HOST  the outgoing server (for a cPanel email account: Email Accounts → Connect Devices → "Outgoing Server")
//   SMTP_PORT  465, or 587
//   SMTP_USER  the whole email address
//   SMTP_PASS  its password
//   MAIL_FROM  only if the codes should come from a different address than SMTP_USER
// Without SMTP_HOST, Gmail is used as manharuwycse@gmail.com (SMTP_PASS is then its app password).
const nodemailer = require("nodemailer");

function mailSettings(env = process.env) {
  const host = env.SMTP_HOST || "smtp.gmail.com", port = Number(env.SMTP_PORT || 465), user = env.SMTP_USER || "manharuwycse@gmail.com";
  // Gmail shows app passwords in groups of four letters; the spaces aren't part of the password.
  const pass = host === "smtp.gmail.com" ? (env.SMTP_PASS || "").replace(/\s/g, "") : env.SMTP_PASS || "";
  return { host, port, user, pass, from: env.MAIL_FROM || user };
}
// No password means no email: the server then shows codes on screen (on your own computer) instead.
const createMailer = s => s.pass ? nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: { user: s.user, pass: s.pass } }) : null;

module.exports = { mailSettings, createMailer };
