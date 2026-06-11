const db = require('../db/postgres');
const AppError = require('../utils/AppError');
const { runWithConcurrency } = require('../utils/concurrency');
const { enqueueEmail } = require('./emailQueueService');
const {
  buildBulkUserPayload,
  createGraphClient,
  createGraphUserWithRetry,
  getVerifiedDomain,
  logAzureUserEvent
} = require('../provisioners/azure/userProvisioner');
const {
  batchAddUsersToGroups,
  batchPatchUsers
} = require('../provisioners/azure/graphBatchProvisioner');

const DEFAULT_CONCURRENCY = Math.max(1, Number(process.env.BULK_PROVISION_CONCURRENCY || 20));
const activeJobs = new Set();

const logProvisioningJobEvent = (level, event, details = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    service: 'bulk-provisioning-jobs',
    level,
    event,
    ...details
  };

  const message = JSON.stringify(entry);

  if (level === 'error') {
    console.error(message);
    return;
  }

  console.log(message);
};

const normalizeHeader = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const parseCsv = (csvText) => {
  const text = String(csvText || '').replace(/^\uFEFF/, '');
  const rows = [];
  let currentField = '';
  let currentRow = [];
  let inQuotes = false;

  const pushField = () => {
    currentRow.push(currentField);
    currentField = '';
  };

  const pushRow = () => {
    rows.push(currentRow);
    currentRow = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentField += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ',') {
      pushField();
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }

      pushField();
      if (currentRow.some((field) => String(field).trim() !== '')) {
        pushRow();
      } else {
        currentRow = [];
      }
      continue;
    }

    currentField += char;
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    pushField();
    if (currentRow.some((field) => String(field).trim() !== '')) {
      pushRow();
    }
  }

  if (rows.length === 0) {
    return [];
  }

  const headers = rows.shift().map((header) => normalizeHeader(header));

  return rows
    .filter((row) => row.some((field) => String(field).trim() !== ''))
    .map((row) => {
      const record = {};

      headers.forEach((header, index) => {
        if (!header) {
          return;
        }

        record[header] = String(row[index] ?? '').trim();
      });

      return record;
    });
};

const getRowField = (row, ...keys) => {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }

  return '';
};

const extractListField = (row, ...keys) => {
  const raw = getRowField(row, ...keys);
  if (!raw) {
    return [];
  }

  return raw
    .split(/[;,]/)
    .map((value) => String(value || '').trim())
    .filter(Boolean);
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const ensureTables = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS provisioning_jobs (
      id BIGSERIAL PRIMARY KEY,
      source_filename TEXT,
      total_users INTEGER NOT NULL DEFAULT 0,
      completed_users INTEGER NOT NULL DEFAULT 0,
      failed_users INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued',
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      input_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
      metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
      error_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS provisioning_job_items (
      id BIGSERIAL PRIMARY KEY,
      job_id BIGINT NOT NULL REFERENCES provisioning_jobs(id) ON DELETE CASCADE,
      row_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      source_row JSONB NOT NULL,
      azure_user_id TEXT,
      username TEXT,
      user_principal_name TEXT,
      temporary_password TEXT,
      error_message TEXT,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (job_id, row_number)
    )
  `);
};

const getProvisioningJobById = async (jobId) => {
  const result = await db.query(
    `
      SELECT
        id,
        source_filename,
        total_users,
        completed_users,
        failed_users,
        status,
        started_at,
        completed_at,
        input_rows,
        metrics,
        error_summary,
        created_at,
        updated_at
      FROM provisioning_jobs
      WHERE id = $1
    `,
    [jobId]
  );

  return result.rows[0] || null;
};

const getJobCounts = async (jobId) => {
  const result = await db.query(
    `
      SELECT
        COUNT(*)::int AS total_users,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_users,
        COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_users,
        COUNT(*) FILTER (WHERE status = 'processing')::int AS processing_users,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_users
      FROM provisioning_job_items
      WHERE job_id = $1
    `,
    [jobId]
  );

  return result.rows[0] || {
    total_users: 0,
    completed_users: 0,
    failed_users: 0,
    processing_users: 0,
    pending_users: 0
  };
};

const syncJobSummary = async (jobId, extraPatch = {}) => {
  const counts = await getJobCounts(jobId);
  const completedUsers = Number(counts.completed_users || 0);
  const failedUsers = Number(counts.failed_users || 0);
  const totalUsers = Number(counts.total_users || 0);
  const pendingUsers = Number(counts.pending_users || 0);
  const processingUsers = Number(counts.processing_users || 0);
  const status =
    extraPatch.status ||
    (pendingUsers === 0 && processingUsers === 0
      ? failedUsers > 0
        ? 'completed_with_errors'
        : 'completed'
      : 'running');

  const metrics = extraPatch.metrics || {};
  const errorSummary = extraPatch.errorSummary || {};

  await db.query(
    `
      UPDATE provisioning_jobs
      SET
        total_users = $2,
        completed_users = $3,
        failed_users = $4,
        status = $5,
        started_at = COALESCE(started_at, $6),
        completed_at = $7,
        metrics = COALESCE($8::jsonb, metrics),
        error_summary = COALESCE($9::jsonb, error_summary),
        updated_at = NOW()
      WHERE id = $1
    `,
    [
      jobId,
      totalUsers,
      completedUsers,
      failedUsers,
      status,
      extraPatch.startedAt || null,
      extraPatch.completedAt || null,
      Object.keys(metrics).length ? JSON.stringify(metrics) : null,
      Object.keys(errorSummary).length ? JSON.stringify(errorSummary) : null
    ]
  );
};

const normalizeTimingMetrics = (timings, completedUsers, failedUsers, startedAt) => {
  const elapsedMs = Math.max(1, Date.now() - startedAt.getTime());
  const elapsedMinutes = elapsedMs / 60000;

  return {
    usersProcessedPerMinute: Number(((completedUsers + failedUsers) / elapsedMinutes).toFixed(2)),
    averageCreateTime: timings.createCount > 0 ? Number((timings.createTotalMs / timings.createCount).toFixed(2)) : 0,
    averageGroupAssignmentTime:
      timings.groupCount > 0 ? Number((timings.groupTotalMs / timings.groupCount).toFixed(2)) : 0,
    averageEmailTime:
      timings.emailCount > 0 ? Number((timings.emailTotalMs / timings.emailCount).toFixed(2)) : 0
  };
};

const parseProvisioningCsv = (csvText) => {
  const rows = parseCsv(csvText);

  if (rows.length === 0) {
    throw new AppError('CSV file is empty or missing a header row.', 400);
  }

  return rows.map((row, index) => ({
    ...row,
    __rowNumber: index + 2
  }));
};

const buildRowSpec = (row, jobId, verifiedDomain, rowNumber) => {
  const displayName =
    getRowField(row, 'displayName', 'displayname', 'name') || `Bulk User ${jobId}-${rowNumber}`;
  const suppliedPrincipalName = getRowField(row, 'userPrincipalName', 'user_principal_name', 'email');
  const localPartBase =
    getRowField(row, 'mailNickname', 'mail_nickname') ||
    (suppliedPrincipalName.includes('@') ? suppliedPrincipalName.split('@')[0] : '') ||
    displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '') ||
    `bulk-${jobId}-${rowNumber}`;

  const mailNickname = localPartBase.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
  const userPrincipalName = `${mailNickname}@${verifiedDomain}`;
  const temporaryPassword = getRowField(row, 'temporaryPassword', 'temporary_password') || 'Temp@12345678';
  const sendWelcomeRaw = getRowField(row, 'sendWelcomeEmail', 'sendwelcomeemail', 'send_welcome_email');
  const notifyEmail = getRowField(row, 'notifyEmail', 'notify_email', 'email');
  const shouldNotify =
    sendWelcomeRaw === ''
      ? Boolean(notifyEmail)
      : ['true', '1', 'yes', 'y', 'on'].includes(sendWelcomeRaw.toLowerCase());

  const updateFields = [];
  const payload = {
    accountEnabled: true,
    displayName,
    mailNickname,
    userPrincipalName,
    passwordProfile: {
      forceChangePasswordNextSignIn: true,
      password: temporaryPassword
    },
    passwordPolicies: 'DisablePasswordExpiration'
  };

  const givenName = getRowField(row, 'givenName', 'given_name');
  const surname = getRowField(row, 'surname');
  const jobTitle = getRowField(row, 'jobTitle', 'job_title');
  const department = getRowField(row, 'department');
  const officeLocation = getRowField(row, 'officeLocation', 'office_location');
  const usageLocation = getRowField(row, 'usageLocation', 'usage_location');

  if (givenName) {
    payload.givenName = givenName;
    updateFields.push('givenName');
  }

  if (surname) {
    payload.surname = surname;
    updateFields.push('surname');
  }

  if (jobTitle) {
    payload.jobTitle = jobTitle;
    updateFields.push('jobTitle');
  }

  if (department) {
    payload.department = department;
    updateFields.push('department');
  }

  if (officeLocation) {
    payload.officeLocation = officeLocation;
    updateFields.push('officeLocation');
  }

  if (usageLocation) {
    payload.usageLocation = usageLocation;
    updateFields.push('usageLocation');
  }

  return {
    rowNumber,
    displayName,
    username: mailNickname,
    userPrincipalName,
    temporaryPassword,
    payload,
    updateFields,
    groupIds: extractListField(row, 'groupIds', 'group_ids', 'groups'),
    notifyEmail: shouldNotify ? notifyEmail || null : null,
    sourceRow: row
  };
};

const buildEmailHtml = ({ displayName, username, userPrincipalName, temporaryPassword, groupIds }) => `
  <!doctype html>
  <html>
    <body style="font-family: Arial, Helvetica, sans-serif; color: #111827; background: #f8fafc; margin: 0; padding: 24px;">
      <div style="max-width: 720px; margin: 0 auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 24px;">
        <h1 style="margin: 0 0 12px; font-size: 24px;">Your Azure account is ready</h1>
        <p style="margin: 0 0 16px;">Hello ${escapeHtml(displayName)}, your account has been provisioned.</p>
        <table style="border-collapse: collapse; width: 100%; margin: 0 0 18px;">
          <tr><td style="padding: 8px 0; color: #6b7280;">Username</td><td style="padding: 8px 0; font-family: Consolas, monospace;">${escapeHtml(username)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">User Principal Name</td><td style="padding: 8px 0; font-family: Consolas, monospace;">${escapeHtml(userPrincipalName)}</td></tr>
          <tr><td style="padding: 8px 0; color: #6b7280;">Temporary Password</td><td style="padding: 8px 0; font-family: Consolas, monospace;">${escapeHtml(temporaryPassword)}</td></tr>
        </table>
        ${groupIds.length ? `<p style="margin: 0; font-size: 13px; color: #6b7280;">Assigned groups: ${groupIds.map(escapeHtml).join(', ')}</p>` : ''}
      </div>
    </body>
  </html>
`;

const insertJobAndItems = async ({ sourceFilename, rows }) => {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const jobResult = await client.query(
      `
        INSERT INTO provisioning_jobs (
          source_filename,
          total_users,
          completed_users,
          failed_users,
          status,
          input_rows,
          metrics,
          error_summary
        )
        VALUES ($1, $2, 0, 0, 'queued', $3::jsonb, '{}'::jsonb, '{}'::jsonb)
        RETURNING id
      `,
      [sourceFilename, rows.length, JSON.stringify(rows)]
    );

    const jobId = jobResult.rows[0].id;

    for (const row of rows) {
      await client.query(
        `
          INSERT INTO provisioning_job_items (
            job_id,
            row_number,
            source_row
          )
          VALUES ($1, $2, $3::jsonb)
        `,
        [jobId, row.__rowNumber, JSON.stringify(row)]
      );
    }

    await client.query('COMMIT');
    return jobId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const createProvisioningJob = async ({ csvText, sourceFilename = null }) => {
  await ensureTables();

  const inputRows = parseProvisioningCsv(csvText);
  const jobId = await insertJobAndItems({ sourceFilename, rows: inputRows });

  setImmediate(() => {
    processProvisioningJob(jobId).catch((error) => {
      logProvisioningJobEvent('error', 'bulk_job_crashed', {
        jobId,
        message: error?.message
      });
    });
  });

  return {
    jobId,
    totalUsers: inputRows.length
  };
};

const claimJobItem = async (itemId) => {
  const result = await db.query(
    `
      UPDATE provisioning_job_items
      SET
        status = 'processing',
        attempts = attempts + 1,
        started_at = COALESCE(started_at, NOW()),
        updated_at = NOW()
      WHERE id = $1
        AND status = 'pending'
      RETURNING *
    `,
    [itemId]
  );

  return result.rows[0] || null;
};

const completeJobItem = async (itemId, update = {}) => {
  await db.query(
    `
      UPDATE provisioning_job_items
      SET
        status = 'completed',
        azure_user_id = $2,
        username = $3,
        user_principal_name = $4,
        temporary_password = $5,
        error_message = NULL,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
    `,
    [
      itemId,
      update.azureUserId,
      update.username,
      update.userPrincipalName,
      update.temporaryPassword
    ]
  );
};

const failJobItem = async (itemId, error) => {
  await db.query(
    `
      UPDATE provisioning_job_items
      SET
        status = 'failed',
        error_message = $2,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
    `,
    [itemId, error?.message || 'Unknown provisioning error']
  );
};

const getCompletedItemsForJob = async (jobId) => {
  const result = await db.query(
    `
      SELECT
        id,
        row_number,
        source_row,
        azure_user_id,
        username,
        user_principal_name,
        temporary_password
      FROM provisioning_job_items
      WHERE job_id = $1
        AND status = 'completed'
      ORDER BY row_number ASC
    `,
    [jobId]
  );

  return result.rows;
};

const getPendingItemsForJob = async (jobId) => {
  const result = await db.query(
    `
      SELECT
        id,
        row_number,
        source_row
      FROM provisioning_job_items
      WHERE job_id = $1
        AND status = 'pending'
      ORDER BY row_number ASC
    `,
    [jobId]
  );

  return result.rows;
};

const updateJobMetrics = async (jobId, metrics, extraPatch = {}) => {
  const current = await getProvisioningJobById(jobId);
  const existingMetrics = current?.metrics && typeof current.metrics === 'object' ? current.metrics : {};
  const mergedMetrics = {
    ...existingMetrics,
    ...metrics
  };

  await db.query(
    `
      UPDATE provisioning_jobs
      SET
        metrics = $2::jsonb,
        error_summary = COALESCE($3::jsonb, error_summary),
        updated_at = NOW()
      WHERE id = $1
    `,
    [
      jobId,
      JSON.stringify(mergedMetrics),
      Object.keys(extraPatch).length ? JSON.stringify(extraPatch) : null
    ]
  );
};

const buildMetricsSnapshot = (timings, completedUsers, failedUsers, startedAt) => normalizeTimingMetrics(
  timings,
  completedUsers,
  failedUsers,
  startedAt
);

const processProvisioningJob = async (jobId) => {
  if (!jobId || activeJobs.has(jobId)) {
    return;
  }

  activeJobs.add(jobId);

  try {
    await ensureTables();

    const job = await getProvisioningJobById(jobId);

    if (!job || !['queued', 'running'].includes(job.status)) {
      return;
    }

    const startedAt = new Date();
    await db.query(
      `
        UPDATE provisioning_jobs
        SET status = 'running',
            started_at = COALESCE(started_at, NOW()),
            updated_at = NOW()
        WHERE id = $1
      `,
      [jobId]
    );

    const { graphClient, subscriptionId } = createGraphClient();
    const verifiedDomain = await getVerifiedDomain(graphClient);
    const concurrency = Math.max(1, Number(process.env.BULK_PROVISION_CONCURRENCY || DEFAULT_CONCURRENCY));
    const pendingItems = await getPendingItemsForJob(jobId);

    logAzureUserEvent('info', 'azure_bulk_provision_started', {
      jobId,
      subscriptionId,
      totalUsers: pendingItems.length,
      concurrency,
      verifiedDomain
    });

    const timings = {
      createCount: 0,
      createTotalMs: 0,
      groupCount: 0,
      groupTotalMs: 0,
      emailCount: 0,
      emailTotalMs: 0
    };

    await runWithConcurrency(
      pendingItems,
      concurrency,
      async (item) => {
        const claimedItem = await claimJobItem(item.id);
        if (!claimedItem) {
          return;
        }

        const sourceRow = claimedItem.source_row || item.source_row || {};
        const rowNumber = Number(claimedItem.row_number || item.row_number || 0);
        const userSpec = buildRowSpec(sourceRow, jobId, verifiedDomain, rowNumber);

        const createStartedAt = Date.now();
        const createdUser = await createGraphUserWithRetry(graphClient, userSpec.payload, jobId);
        timings.createCount += 1;
        timings.createTotalMs += Date.now() - createStartedAt;

        await completeJobItem(claimedItem.id, {
          azureUserId: createdUser.id,
          username: userSpec.username,
          userPrincipalName: userSpec.userPrincipalName,
          temporaryPassword: userSpec.temporaryPassword
        });

        if (userSpec.notifyEmail) {
          const emailStart = Date.now();
          await enqueueEmail({
            recipientEmail: userSpec.notifyEmail,
            subject: 'Your Azure account is ready',
            html: buildEmailHtml({
              displayName: userSpec.displayName,
              username: userSpec.username,
              userPrincipalName: userSpec.userPrincipalName,
              temporaryPassword: userSpec.temporaryPassword,
              groupIds: userSpec.groupIds
            }),
            relatedType: 'bulk_provisioning_job',
            relatedId: String(jobId)
          });
          timings.emailCount += 1;
          timings.emailTotalMs += Date.now() - emailStart;
        }

        const current = await getJobCounts(jobId);
        const metrics = buildMetricsSnapshot(
          timings,
          Number(current.completed_users || 0) + 1,
          Number(current.failed_users || 0),
          startedAt
        );

        await updateJobMetrics(jobId, metrics);
      },
      {
        continueOnError: true,
        onError: async (error, item) => {
          await failJobItem(item.id, error);
          const current = await getJobCounts(jobId);
          const metrics = buildMetricsSnapshot(
            timings,
            Number(current.completed_users || 0),
            Number(current.failed_users || 0) + 1,
            startedAt
          );
          await updateJobMetrics(jobId, metrics, {
            failedRows: [
              {
                rowNumber: item.row_number,
                message: error?.message,
                code: error?.code || null,
                statusCode: error?.statusCode || error?.status || null
              }
            ]
          });
        }
      }
    );

    const completedItems = await getCompletedItemsForJob(jobId);
    const usersForBatching = completedItems.map((item) => {
      const sourceRow = item.source_row || {};
      const userSpec = buildRowSpec(sourceRow, jobId, verifiedDomain, Number(item.row_number));

      return {
        azureUserId: item.azure_user_id,
        username: item.username || userSpec.username,
        userPrincipalName: item.user_principal_name || userSpec.userPrincipalName,
        temporaryPassword: item.temporary_password || userSpec.temporaryPassword,
        groupIds: userSpec.groupIds,
        updateFields: userSpec.updateFields,
        sourceRow
      };
    });

    const usersBySignature = new Map();
    const usersByGroup = new Map();

    for (const user of usersForBatching) {
      const signature = JSON.stringify(user.updateFields || []);
      if (!usersBySignature.has(signature)) {
        usersBySignature.set(signature, []);
      }
      usersBySignature.get(signature).push(user);

      for (const groupId of user.groupIds || []) {
        if (!usersByGroup.has(groupId)) {
          usersByGroup.set(groupId, []);
        }
        usersByGroup.get(groupId).push(user);
      }
    }

    for (const [signature, users] of usersBySignature.entries()) {
      const patchFields = JSON.parse(signature);
      if (!Array.isArray(patchFields) || patchFields.length === 0 || users.length === 0) {
        continue;
      }

      const patchStartedAt = Date.now();
      await batchPatchUsers(graphClient, users, patchFields, `job-${jobId}-patch`);
      timings.groupCount += users.length;
      timings.groupTotalMs += Date.now() - patchStartedAt;
    }

    for (const [groupId, users] of usersByGroup.entries()) {
      if (!groupId || users.length === 0) {
        continue;
      }

      const groupStartedAt = Date.now();
      await batchAddUsersToGroups(graphClient, groupId, users, `job-${jobId}-group-${groupId}`);
      timings.groupCount += users.length;
      timings.groupTotalMs += Date.now() - groupStartedAt;
    }

    const finalCounts = await getJobCounts(jobId);
    const finalMetrics = buildMetricsSnapshot(
      timings,
      Number(finalCounts.completed_users || 0),
      Number(finalCounts.failed_users || 0),
      startedAt
    );
    const finalStatus =
      Number(finalCounts.pending_users || 0) === 0 && Number(finalCounts.processing_users || 0) === 0
        ? Number(finalCounts.failed_users || 0) > 0
          ? 'completed_with_errors'
          : 'completed'
        : 'running';

    await db.query(
      `
        UPDATE provisioning_jobs
        SET
          status = $2,
          completed_at = $3,
          metrics = $4::jsonb,
          error_summary = COALESCE(error_summary, '{}'::jsonb),
          completed_users = $5,
          failed_users = $6,
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        jobId,
        finalStatus,
        finalStatus === 'completed' || finalStatus === 'completed_with_errors' ? new Date() : null,
        JSON.stringify(finalMetrics),
        Number(finalCounts.completed_users || 0),
        Number(finalCounts.failed_users || 0)
      ]
    );

    logProvisioningJobEvent('info', 'bulk_job_completed', {
      jobId,
      totalUsers: Number(finalCounts.total_users || 0),
      completedUsers: Number(finalCounts.completed_users || 0),
      failedUsers: Number(finalCounts.failed_users || 0),
      metrics: finalMetrics
    });
  } catch (error) {
    await db.query(
      `
        UPDATE provisioning_jobs
        SET
          status = 'failed',
          completed_at = NOW(),
          error_summary = $2::jsonb,
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        jobId,
        JSON.stringify({
          message: error?.message,
          code: error?.code || null,
          statusCode: error?.statusCode || error?.status || null
        })
      ]
    );

    logProvisioningJobEvent('error', 'bulk_job_failed', {
      jobId,
      message: error?.message,
      code: error?.code || null,
      statusCode: error?.statusCode || error?.status || null
    });

    throw error;
  } finally {
    activeJobs.delete(jobId);
  }
};

const resumeProvisioningJobs = async () => {
  await ensureTables();

  const result = await db.query(
    `
      SELECT id
      FROM provisioning_jobs
      WHERE status IN ('queued', 'running')
      ORDER BY created_at ASC
    `
  );

  for (const row of result.rows) {
    if (!activeJobs.has(row.id)) {
      setImmediate(() => {
        processProvisioningJob(row.id).catch((error) => {
          logProvisioningJobEvent('error', 'bulk_job_resume_failed', {
            jobId: row.id,
            message: error?.message
          });
        });
      });
    }
  }
};

const getProvisioningJobProgress = async (jobId) => {
  await ensureTables();

  const job = await getProvisioningJobById(jobId);
  if (!job) {
    throw new AppError('Provisioning job not found.', 404);
  }

  const counts = await getJobCounts(jobId);
  const totalUsers = Number(counts.total_users || job.total_users || 0);
  const completedUsers = Number(counts.completed_users || job.completed_users || 0);
  const failedUsers = Number(counts.failed_users || job.failed_users || 0);
  const pendingUsers = Number(counts.pending_users || 0);
  const processingUsers = Number(counts.processing_users || 0);
  const status =
    pendingUsers === 0 && processingUsers === 0
      ? failedUsers > 0
        ? 'completed_with_errors'
        : 'completed'
      : job.status;

  return {
    jobId: Number(job.id),
    sourceFilename: job.source_filename,
    totalUsers,
    completedUsers,
    failedUsers,
    pendingUsers,
    processingUsers,
    status,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    metrics: job.metrics || {},
    errorSummary: job.error_summary || {},
    createdAt: job.created_at,
    updatedAt: job.updated_at
  };
};

module.exports = {
  createProvisioningJob,
  getProvisioningJobProgress,
  processProvisioningJob,
  resumeProvisioningJobs
};
