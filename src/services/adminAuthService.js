const crypto = require('crypto');
const db = require('../db/postgres');
const AppError = require('../utils/AppError');

const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_ALGORITHM = 'scrypt';
const TEMP_PASSWORD_BYTES = 18;

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const normalizeUsername = (username) => String(username || '').trim().toLowerCase();

const buildUsernameFromEmail = (email) => {
  const normalizedEmail = normalizeEmail(email);
  const localPart = normalizedEmail.split('@')[0] || 'admin';
  const safeLocalPart = localPart.replace(/[^a-z0-9._-]/gi, '').slice(0, 40) || 'admin';
  return `${safeLocalPart}-${crypto.randomBytes(3).toString('hex')}`;
};

const generateTemporaryPassword = () =>
  crypto.randomBytes(TEMP_PASSWORD_BYTES).toString('base64url');

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('base64url');
  const key = crypto.scryptSync(String(password), salt, PASSWORD_KEY_LENGTH).toString('base64url');
  return `${PASSWORD_ALGORITHM}$${salt}$${key}`;
};

const verifyPassword = (password, storedHash) => {
  const [algorithm, salt, key] = String(storedHash || '').split('$');

  if (algorithm !== PASSWORD_ALGORITHM || !salt || !key) {
    return false;
  }

  const expected = Buffer.from(key, 'base64url');
  const actual = crypto.scryptSync(String(password), salt, expected.length);

  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
};

const issueTemporaryAdminCredentials = async ({ email, name = null }) => {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw new AppError('Admin email is required.', 400);
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = hashPassword(temporaryPassword);

  const existingResult = await db.query(
    `
      SELECT id, username
      FROM admins
      WHERE lower(email) = $1
      LIMIT 1
    `,
    [normalizedEmail]
  );

  if (existingResult.rows.length > 0) {
    const admin = existingResult.rows[0];

    await db.query(
      `
        UPDATE admins
        SET password_hash = $2,
            status = 'active',
            must_change_password = true,
            updated_at = NOW()
        WHERE id = $1
      `,
      [admin.id, passwordHash]
    );

    return {
      adminId: admin.id,
      email: normalizedEmail,
      username: admin.username,
      temporaryPassword
    };
  }

  const username = buildUsernameFromEmail(normalizedEmail);
  const insertResult = await db.query(
    `
      INSERT INTO admins (
        name,
        email,
        username,
        password_hash,
        role,
        status,
        must_change_password
      )
      VALUES ($1, $2, $3, $4, 'admin', 'active', true)
      RETURNING id, username
    `,
    [name || normalizedEmail, normalizedEmail, username, passwordHash]
  );

  return {
    adminId: insertResult.rows[0].id,
    email: normalizedEmail,
    username: insertResult.rows[0].username,
    temporaryPassword
  };
};

const verifyAdminCredentials = async ({ email, username, password }) => {
  const normalizedEmail = normalizeEmail(email);
  const normalizedUsername = normalizeUsername(username);

  if (!normalizedUsername || !password) {
    throw new AppError('Username and password are required.', 400);
  }

  const result = await db.query(
    `
      SELECT id, email, username, password_hash, role, status, must_change_password
      FROM admins
      WHERE lower(username) = $1
        AND lower(email) = $2
      LIMIT 1
    `,
    [normalizedUsername, normalizedEmail]
  );

  const admin = result.rows[0] || null;

  if (!admin || admin.status !== 'active' || !verifyPassword(password, admin.password_hash)) {
    throw new AppError('Invalid admin username or password.', 401);
  }

  await db.query(
    `
      UPDATE admins
      SET last_login_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
    `,
    [admin.id]
  );

  return {
    id: admin.id,
    email: admin.email,
    username: admin.username,
    role: admin.role,
    mustChangePassword: admin.must_change_password
  };
};

const ORG_ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const ensureOrgAdminFromEnv = async () => {
  const email = normalizeEmail(process.env.ORG_ADMIN_EMAIL);
  const password = String(process.env.ORG_ADMIN_PASSWORD || '').trim();
  const username = normalizeUsername(process.env.ORG_ADMIN_USERNAME || 'org-admin');

  if (!email || !password) {
    return null;
  }

  const passwordHash = hashPassword(password);
  const existingResult = await db.query(
    `
      SELECT id, username
      FROM admins
      WHERE lower(email) = $1
      LIMIT 1
    `,
    [email]
  );

  if (existingResult.rows.length > 0) {
    const admin = existingResult.rows[0];

    await db.query(
      `
        UPDATE admins
        SET password_hash = $2,
            role = 'org_admin',
            status = 'active',
            must_change_password = false,
            updated_at = NOW()
        WHERE id = $1
      `,
      [admin.id, passwordHash]
    );

    return {
      id: admin.id,
      email,
      username: admin.username
    };
  }

  const insertResult = await db.query(
    `
      INSERT INTO admins (
        name,
        email,
        username,
        password_hash,
        role,
        status,
        must_change_password
      )
      VALUES ($1, $2, $3, $4, 'org_admin', 'active', false)
      RETURNING id, username
    `,
    [email, email, username, passwordHash]
  );

  return {
    id: insertResult.rows[0].id,
    email,
    username: insertResult.rows[0].username
  };
};

const verifyOrgAdminCredentials = async ({ email, username, password }) => {
  await ensureOrgAdminFromEnv();

  const normalizedEmail = normalizeEmail(email);
  const normalizedUsername = normalizeUsername(username);

  if (!normalizedEmail || !normalizedUsername || !password) {
    throw new AppError('Email, username, and password are required.', 400);
  }

  const result = await db.query(
    `
      SELECT id, email, username, password_hash, role, status, must_change_password
      FROM admins
      WHERE lower(username) = $1
        AND lower(email) = $2
        AND role = 'org_admin'
      LIMIT 1
    `,
    [normalizedUsername, normalizedEmail]
  );

  const admin = result.rows[0] || null;

  if (!admin || admin.status !== 'active' || !verifyPassword(password, admin.password_hash)) {
    throw new AppError('Invalid organization admin credentials.', 401);
  }

  await db.query(
    `
      UPDATE admins
      SET last_login_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
    `,
    [admin.id]
  );

  return {
    id: admin.id,
    email: admin.email,
    username: admin.username,
    role: admin.role,
    mustChangePassword: admin.must_change_password
  };
};

const createOrgAdminSession = async (adminId) => {
  const sessionToken = crypto.randomUUID();
  const sessionHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
  const expiresAt = new Date(Date.now() + ORG_ADMIN_SESSION_TTL_MS);

  await db.query(
    `
      INSERT INTO org_admin_sessions (
        admin_id,
        session_hash,
        expires_at,
        revoked
      )
      VALUES ($1, $2, $3, false)
    `,
    [adminId, sessionHash, expiresAt]
  );

  return {
    sessionToken,
    expiresAt
  };
};

const getOrgAdminSession = async (sessionToken) => {
  const token = String(sessionToken || '').trim();

  if (!token) {
    return null;
  }

  const sessionHash = crypto.createHash('sha256').update(token).digest('hex');
  const result = await db.query(
    `
      SELECT
        oas.id,
        oas.admin_id,
        oas.expires_at,
        oas.revoked,
        a.email,
        a.username,
        a.role,
        a.status
      FROM org_admin_sessions oas
      JOIN admins a ON a.id = oas.admin_id
      WHERE oas.session_hash = $1
        AND oas.revoked = false
        AND oas.expires_at > NOW()
      LIMIT 1
    `,
    [sessionHash]
  );

  return result.rows[0] || null;
};

const requireOrgAdminSession = async (sessionToken) => {
  const session = await getOrgAdminSession(sessionToken);

  if (!session || session.status !== 'active' || session.role !== 'org_admin') {
    throw new AppError('Organization admin session is invalid or expired.', 401);
  }

  return session;
};

module.exports = {
  issueTemporaryAdminCredentials,
  verifyAdminCredentials,
  verifyOrgAdminCredentials,
  createOrgAdminSession,
  getOrgAdminSession,
  requireOrgAdminSession,
  ensureOrgAdminFromEnv
};
