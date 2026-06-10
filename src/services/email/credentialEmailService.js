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

const buildCredentialEmailHtml = ({ requestId, users, adminCredentials, portalLink, expiresAt }) => {
  const rowsHtml = users
    .map(
      (user, index) => `
        <tr>
          <td style="border-bottom: 1px solid #e5e7eb; padding: 12px 10px;">${index + 1}</td>
          <td style="border-bottom: 1px solid #e5e7eb; padding: 12px 10px;">${escapeHtml(user.username)}</td>
          <td style="border-bottom: 1px solid #e5e7eb; padding: 12px 10px;">${escapeHtml(user.temporary_password)}</td>
          <td style="border-bottom: 1px solid #e5e7eb; padding: 12px 10px;">${escapeHtml(user.azure_user_id)}</td>
          <td style="border-bottom: 1px solid #e5e7eb; padding: 12px 10px;">${escapeHtml(user.status || 'active')}</td>
        </tr>
      `
    )
    .join('');

  return `
    <!doctype html>
    <html>
      <body style="font-family: Arial, Helvetica, sans-serif; color: #111827; background: #f8fafc; margin: 0; padding: 24px;">
        <div style="max-width: 760px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 28px;">
          <h1 style="margin: 0 0 8px; font-size: 26px; line-height: 1.2;">Your Azure Access Portal</h1>
          <p style="margin: 0 0 20px; font-size: 16px; color: #374151;">Provisioning completed for request <strong>#${escapeHtml(requestId)}</strong>.</p>
          <div style="overflow-x: auto;">
          <table style="border-collapse: collapse; width: 100%; min-width: 680px; border: 1px solid #e5e7eb; border-radius: 12px;">
            <thead>
              <tr>
                <th style="border-bottom: 1px solid #d1d5db; text-align: left; padding: 12px 10px; background: #f9fafb; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em;">#</th>
                <th style="border-bottom: 1px solid #d1d5db; text-align: left; padding: 12px 10px; background: #f9fafb; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em;">Username</th>
                <th style="border-bottom: 1px solid #d1d5db; text-align: left; padding: 12px 10px; background: #f9fafb; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em;">Temporary Password</th>
                <th style="border-bottom: 1px solid #d1d5db; text-align: left; padding: 12px 10px; background: #f9fafb; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em;">Azure User ID</th>
                <th style="border-bottom: 1px solid #d1d5db; text-align: left; padding: 12px 10px; background: #f9fafb; font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          </div>
          <div style="margin-top: 24px; padding: 20px; border: 1px solid #e5e7eb; border-radius: 14px; background: #f9fafb;">
            <p style="margin: 0 0 12px; font-size: 14px; font-weight: 700; color: #374151;">Admin Portal Login</p>
            <table style="border-collapse: collapse; width: 100%; margin: 0 0 16px;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280; width: 150px;">Username</td>
                <td style="padding: 8px 0; font-family: Consolas, monospace; color: #111827;">${escapeHtml(adminCredentials?.username || '')}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Temporary Password</td>
                <td style="padding: 8px 0; font-family: Consolas, monospace; color: #111827;">${escapeHtml(adminCredentials?.temporaryPassword || '')}</td>
              </tr>
            </table>
            <a
              href="${escapeHtml(portalLink)}"
              style="display: inline-block; background: #111827; color: #ffffff; text-decoration: none; padding: 12px 18px; border-radius: 10px; font-weight: 700;"
            >
              Open Admin Portal
            </a>
            <p style="margin: 14px 0 0; font-size: 14px; word-break: break-all;">
              <a href="${escapeHtml(portalLink)}" style="color: #2563eb;">${escapeHtml(portalLink)}</a>
            </p>
          </div>
          <p style="margin: 18px 0 0; font-size: 13px; color: #6b7280;">
            This secure link expires in 7 days.
          </p>
          <p style="margin: 8px 0 0; font-size: 13px; color: #6b7280;">
            Use the temporary admin credentials above to sign in before managing users.
          </p>
        </div>
      </body>
    </html>
  `;
};

const buildAccessPortalEmailHtml = ({ requestId, manageUrl, expiresAt }) => `
  <!doctype html>
  <html>
    <body style="font-family: Arial, Helvetica, sans-serif; color: #111827; background: #f8fafc; margin: 0; padding: 24px;">
      <div style="max-width: 720px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 24px;">
        <h1 style="margin: 0 0 12px; font-size: 24px;">Your Azure Access Portal</h1>
        <p style="margin: 0 0 16px;">Provisioning completed for request <strong>#${escapeHtml(requestId)}</strong>.</p>
        <p style="margin: 0 0 20px;">
          Manage users here:
          <a href="${escapeHtml(manageUrl)}" style="color: #2563eb; word-break: break-all;">${escapeHtml(manageUrl)}</a>
        </p>
        <p style="margin: 0; font-size: 13px; color: #6b7280;">
          Link expires in 7 days${expiresAt ? ` on ${escapeHtml(expiresAt)}` : ''}.
        </p>
      </div>
    </body>
  </html>
`;

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
  buildAccessPortalEmailHtml,
  sendCredentialEmailWithRetry
};
