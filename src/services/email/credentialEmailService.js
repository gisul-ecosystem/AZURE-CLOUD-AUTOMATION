const nodemailer = require('nodemailer');
const AppError = require('../../utils/AppError');

const REQUIRED_SMTP_ENV_VARS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
const MAX_ATTEMPTS = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getTrimmedEnvValue = (name) => {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
};

const validateSmtpEnv = () => {
  const smtpPassword = getTrimmedEnvValue('SMTP_PASS') || getTrimmedEnvValue('SMTP_PASSWORD');
  const smtpFrom = getTrimmedEnvValue('SMTP_FROM') || getTrimmedEnvValue('SMTP_USER');
  const envValues = REQUIRED_SMTP_ENV_VARS.reduce((accumulator, name) => {
    accumulator[name] = getTrimmedEnvValue(name);
    return accumulator;
  }, {});

  envValues.SMTP_PASS = smtpPassword;
  envValues.SMTP_FROM = smtpFrom;

  const missingVars = REQUIRED_SMTP_ENV_VARS.filter((name) => !envValues[name]);

  if (missingVars.length > 0) {
    throw new AppError(`Missing required SMTP environment variable(s): ${missingVars.join(', ')}`, 500);
  }

  const smtpPort = Number(envValues.SMTP_PORT);

  if (!Number.isInteger(smtpPort) || smtpPort <= 0) {
    throw new AppError('SMTP_PORT must be a positive integer.', 500);
  }

  const secure = process.env.SMTP_SECURE === undefined
    ? smtpPort === 465
    : ['true', '1', 'yes'].includes(String(process.env.SMTP_SECURE).trim().toLowerCase());

  return {
    host: envValues.SMTP_HOST,
    port: smtpPort,
    secure,
    auth: {
      user: envValues.SMTP_USER,
      pass: envValues.SMTP_PASS
    },
    from: envValues.SMTP_FROM
  };
};

const createSmtpTransport = () => {
  const smtpConfig = validateSmtpEnv();

  return {
    transporter: nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: smtpConfig.auth
    }),
    from: smtpConfig.from
  };
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const buildCredentialEmailHtml = ({ requestId, users }) => {
  const rowsHtml = users
    .map(
      (user, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(user.username)}</td>
          <td>${escapeHtml(user.temporaryPassword)}</td>
        </tr>
      `
    )
    .join('');

  return `
    <!doctype html>
    <html>
      <body style="font-family: Arial, Helvetica, sans-serif; color: #111827; background: #f8fafc; margin: 0; padding: 24px;">
        <div style="max-width: 720px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 24px;">
          <h1 style="margin: 0 0 12px; font-size: 24px;">Azure Access Credentials</h1>
          <p style="margin: 0 0 16px;">Your request <strong>#${escapeHtml(requestId)}</strong> has been provisioned. Use the temporary credentials below to sign in.</p>
          <table style="border-collapse: collapse; width: 100%; margin-top: 20px;">
            <thead>
              <tr>
                <th style="border-bottom: 1px solid #d1d5db; text-align: left; padding: 10px;">#</th>
                <th style="border-bottom: 1px solid #d1d5db; text-align: left; padding: 10px;">Username</th>
                <th style="border-bottom: 1px solid #d1d5db; text-align: left; padding: 10px;">Temporary Password</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <p style="margin: 20px 0 0; font-size: 13px; color: #6b7280;">
            For security, change the temporary password on first sign-in.
          </p>
        </div>
      </body>
    </html>
  `;
};

const isRetryableEmailError = (error) => {
  const statusCode = Number(error?.statusCode || error?.responseCode || error?.status);
  const errorCode = String(error?.code || '').toUpperCase();

  return (
    [421, 450, 451, 452, 454, 455, 500, 502, 503, 504].includes(statusCode) ||
    ['ETIMEDOUT', 'ECONNRESET', 'ESOCKET', 'EAUTH', 'ECONNECTION'].includes(errorCode)
  );
};

const sendCredentialEmailWithRetry = async ({ to, subject, html }) => {
  const { transporter, from } = createSmtpTransport();
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await transporter.sendMail({
        from,
        to,
        subject,
        html
      });
    } catch (error) {
      lastError = error;

      if (attempt === MAX_ATTEMPTS || !isRetryableEmailError(error)) {
        throw error;
      }

      await sleep(500 * 2 ** (attempt - 1));
    }
  }

  throw lastError;
};

module.exports = {
  buildCredentialEmailHtml,
  sendCredentialEmailWithRetry
};
