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

module.exports = {
  issueTemporaryAdminCredentials,
  verifyAdminCredentials
};
