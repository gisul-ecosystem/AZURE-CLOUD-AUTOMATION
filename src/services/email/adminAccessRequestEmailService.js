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

const buildRolesListHtml = (roles = []) => {
  if (!roles.length) {
    return '<p style="margin: 0;">No specific roles were matched from your request.</p>';
  }

  return `
    <ul style="margin: 0; padding-left: 20px;">
      ${roles.map((role) => `<li>${escapeHtml(role)}</li>`).join('')}
    </ul>
  `;
};

const buildApprovedEmailHtml = ({
  serviceName,
  requestedAccess,
  grantedRoles,
  accessApplied,
  reviewNotes
}) => `
  <!doctype html>
  <html>
    <body style="font-family: Arial, Helvetica, sans-serif; color: #111827; background: #f8fafc; margin: 0; padding: 24px;">
      <div style="max-width: 720px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 24px;">
        <h1 style="margin: 0 0 12px; font-size: 24px;">Admin Access Request Approved</h1>
        <p style="margin: 0 0 16px;">
          Your request for elevated access to <strong>${escapeHtml(serviceName)}</strong> has been approved.
        </p>
        <p style="margin: 0 0 8px; font-weight: 600;">Requested access</p>
        <p style="margin: 0 0 16px; white-space: pre-wrap;">${escapeHtml(requestedAccess)}</p>
        <p style="margin: 0 0 8px; font-weight: 600;">
          ${accessApplied ? 'Permissions granted' : 'Permissions scheduled'}
        </p>
        ${buildRolesListHtml(grantedRoles)}
        <p style="margin: 16px 0 0; color: #374151;">
          ${
            accessApplied
              ? 'These permissions have been applied to your Azure user account(s). You can sign in and use the elevated access now.'
              : 'These permissions will be applied automatically once your Azure environment is ready.'
          }
        </p>
        ${
          reviewNotes
            ? `<p style="margin: 16px 0 0; padding: 12px; background: #f3f4f6; border-radius: 8px;"><strong>Review notes:</strong> ${escapeHtml(reviewNotes)}</p>`
            : ''
        }
      </div>
    </body>
  </html>
`;

const buildRejectedEmailHtml = ({ serviceName, requestedAccess, reviewNotes }) => `
  <!doctype html>
  <html>
    <body style="font-family: Arial, Helvetica, sans-serif; color: #111827; background: #f8fafc; margin: 0; padding: 24px;">
      <div style="max-width: 720px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 24px;">
        <h1 style="margin: 0 0 12px; font-size: 24px;">Admin Access Request Update</h1>
        <p style="margin: 0 0 16px;">
          Your request for elevated access to <strong>${escapeHtml(serviceName)}</strong> was not approved at this time.
        </p>
        <p style="margin: 0 0 8px; font-weight: 600;">Requested access</p>
        <p style="margin: 0 0 16px; white-space: pre-wrap;">${escapeHtml(requestedAccess)}</p>
        ${
          reviewNotes
            ? `<p style="margin: 0; padding: 12px; background: #f3f4f6; border-radius: 8px;"><strong>Review notes:</strong> ${escapeHtml(reviewNotes)}</p>`
            : '<p style="margin: 0; color: #374151;">Contact your organization admin if you need more details.</p>'
        }
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

const sendAdminAccessDecisionEmailWithRetry = async ({ to, subject, html }) => {
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

const sendAdminAccessDecisionEmail = async ({
  customerEmail,
  serviceName,
  requestedAccess,
  status,
  grantedRoles = [],
  accessApplied = false,
  reviewNotes = null
}) => {
  const normalizedStatus = String(status || '').trim().toLowerCase();
  const isApproved = normalizedStatus === 'approved';
  const html = isApproved
    ? buildApprovedEmailHtml({
        serviceName,
        requestedAccess,
        grantedRoles,
        accessApplied,
        reviewNotes
      })
    : buildRejectedEmailHtml({
        serviceName,
        requestedAccess,
        reviewNotes
      });

  await sendAdminAccessDecisionEmailWithRetry({
    to: customerEmail,
    subject: isApproved
      ? `Admin Access Approved — ${serviceName}`
      : `Admin Access Request Update — ${serviceName}`,
    html
  });
};

module.exports = {
  buildApprovedEmailHtml,
  buildRejectedEmailHtml,
  sendAdminAccessDecisionEmail,
  sendAdminAccessDecisionEmailWithRetry
};
