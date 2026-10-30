import config from '../config.js';

/**
 * Transactional email. SMTP is optional: without SMTP_HOST the message is
 * logged (development) instead of sent, so verification and reset can still be
 * exercised locally. Production can require SMTP via config validation.
 */

let transportPromise = null;

async function getTransport() {
  if (!config.mail.host) return null;
  if (!transportPromise) {
    transportPromise = import('nodemailer').then(({ default: nodemailer }) => nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
    }));
  }
  return transportPromise;
}

export async function sendMail(logger, { to, subject, text }) {
  const transport = await getTransport();
  if (!transport) {
    if (config.isProduction) {
      logger?.warn({ to, subject }, 'SMTP is not configured — email was not sent');
    } else {
      // Development only: surface the link so verification/reset can be tested.
      logger?.info({ to, subject, body: text }, 'SMTP not configured — email logged instead of sent');
    }
    return { sent: false };
  }

  await transport.sendMail({ from: config.mail.from, to, subject, text });
  return { sent: true };
}

export function verificationEmail(name, link) {
  return {
    subject: 'Verify your Shortly email address',
    text: `Hi${name ? ` ${name}` : ''},\n\nConfirm your email to finish setting up your Shortly account:\n\n${link}\n\nThis link expires in 60 minutes. If you did not create this account, ignore this email.`,
  };
}

export function resetEmail(name, link) {
  return {
    subject: 'Reset your Shortly password',
    text: `Hi${name ? ` ${name}` : ''},\n\nUse this link to choose a new password:\n\n${link}\n\nThis link expires in 30 minutes and can only be used once. If you did not request a reset, ignore this email.`,
  };
}
