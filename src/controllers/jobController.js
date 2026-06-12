const AppError = require('../utils/AppError');
const provisioningJobService = require('../services/provisioningJobService');

const validateJobId = (jobId) => {
  if (!/^\d+$/.test(jobId)) {
    throw new AppError('Job id must be a positive integer.', 400);
  }
};

const createProvisioningJob = async (req, res, next) => {
  try {
    const csvText =
      typeof req.body === 'string'
        ? req.body
        : String(req.body?.csv || req.body?.csvText || req.body?.content || '').trim();

    if (!csvText) {
      throw new AppError('CSV content is required.', 400);
    }

    const result = await provisioningJobService.createProvisioningJob({
      csvText,
      sourceFilename: req.headers['x-file-name'] || req.body?.sourceFilename || null
    });

    res.status(202).json({
      success: true,
      jobId: result.jobId,
      totalUsers: result.totalUsers,
      status: 'queued'
    });
  } catch (error) {
    next(error);
  }
};

const getProvisioningJob = async (req, res, next) => {
  try {
    validateJobId(req.params.jobId);

    const job = await provisioningJobService.getProvisioningJobProgress(Number(req.params.jobId));

    res.status(200).json({
      success: true,
      job
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createProvisioningJob,
  getProvisioningJob
};
