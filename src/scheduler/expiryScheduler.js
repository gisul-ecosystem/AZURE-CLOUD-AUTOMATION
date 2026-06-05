const cron = require('node-cron');
const cleanupService = require('../services/cleanupService');

let scheduledTask = null;

const logSchedulerEvent = (level, event, details = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    service: 'expiry-scheduler',
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

const runExpiryCleanupJob = async () => {
  logSchedulerEvent('info', 'cleanup_scheduler_run_started');

  try {
    const results = await cleanupService.cleanupExpiredRequests();

    logSchedulerEvent('info', 'cleanup_scheduler_run_completed', {
      processed: results.length,
      successCount: results.filter((result) => result.success).length,
      failureCount: results.filter((result) => !result.success).length
    });

    return results;
  } catch (error) {
    logSchedulerEvent('error', 'cleanup_scheduler_run_failed', {
      errorName: error?.name,
      errorCode: error?.code,
      statusCode: error?.statusCode || error?.status,
      message: error?.message
    });

    throw error;
  }
};

const startExpiryScheduler = () => {
  if (scheduledTask) {
    return scheduledTask;
  }

  logSchedulerEvent('info', 'cleanup_scheduler_started', {
    schedule: '0 2 * * *',
    timezone: 'Asia/Kolkata'
  });

  scheduledTask = cron.schedule(
    '0 2 * * *',
    () => {
      runExpiryCleanupJob().catch((error) => {
        logSchedulerEvent('error', 'cleanup_scheduler_unhandled_error', {
          errorName: error?.name,
          errorCode: error?.code,
          statusCode: error?.statusCode || error?.status,
          message: error?.message
        });
      });
    },
    {
      timezone: 'Asia/Kolkata'
    }
  );

  return scheduledTask;
};

module.exports = {
  runExpiryCleanupJob,
  startExpiryScheduler
};
