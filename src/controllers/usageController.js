const AppError = require('../utils/AppError');
const usageService = require('../services/usageService');

/**
 * Start a usage session for a user
 * POST /api/usage/start
 * Body: { requestId, userId }
 */
const startUsageSession = async (req, res, next) => {
  try {
    const { requestId, userId } = req.body;

    if (!requestId || !Number.isInteger(Number(requestId)) || Number(requestId) <= 0) {
      throw new AppError('requestId must be a positive integer.', 400);
    }

    if (!userId || !Number.isInteger(Number(userId)) || Number(userId) <= 0) {
      throw new AppError('userId must be a positive integer.', 400);
    }

    console.log(`[SESSION_START_REQUEST] User ${userId} requesting session for request ${requestId}`);

    const session = await usageService.startUsageSession({
      requestId: Number(requestId),
      userId: Number(userId)
    });

    console.log(`[SESSION_START_SUCCESS] Session ${session.sessionId} started for user ${userId}`);

    res.status(201).json({
      success: true,
      message: 'Usage session started.',
      data: session
    });
  } catch (error) {
    console.error(`[SESSION_START_ERROR] Failed to start session:`, error.message);
    next(error);
  }
};

/**
 * End a usage session for a user
 * POST /api/usage/end
 * Body: { requestId, userId }
 */
const endUsageSession = async (req, res, next) => {
  try {
    const { requestId, userId } = req.body;

    if (!requestId || !Number.isInteger(Number(requestId)) || Number(requestId) <= 0) {
      throw new AppError('requestId must be a positive integer.', 400);
    }

    if (!userId || !Number.isInteger(Number(userId)) || Number(userId) <= 0) {
      throw new AppError('userId must be a positive integer.', 400);
    }

    const result = await usageService.endUsageSession({
      requestId: Number(requestId),
      userId: Number(userId)
    });

    res.status(200).json({
      success: true,
      message: 'Usage session ended.',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get usage status for a user
 * GET /api/usage/status/:requestId/:userId
 */
const getUsageStatus = async (req, res, next) => {
  try {
    const { requestId, userId } = req.params;

    if (!requestId || !Number.isInteger(Number(requestId)) || Number(requestId) <= 0) {
      throw new AppError('requestId must be a positive integer.', 400);
    }

    if (!userId || !Number.isInteger(Number(userId)) || Number(userId) <= 0) {
      throw new AppError('userId must be a positive integer.', 400);
    }

    const status = await usageService.getUsageStatus({
      requestId: Number(requestId),
      userId: Number(userId)
    });

    res.status(200).json({
      success: true,
      data: status
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all active sessions
 * GET /api/usage/sessions/active
 */
const getActiveSessions = async (req, res, next) => {
  try {
    const sessions = await usageService.getActiveSessions();

    res.status(200).json({
      success: true,
      data: sessions,
      count: sessions.length
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Force logout a user - close all active sessions and block access
 * POST /api/usage/force-logout
 * Body: { requestId, userId }
 */
const forceLogout = async (req, res, next) => {
  try {
    const { requestId, userId } = req.body;

    if (!requestId || !Number.isInteger(Number(requestId)) || Number(requestId) <= 0) {
      throw new AppError('requestId must be a positive integer.', 400);
    }

    if (!userId || !Number.isInteger(Number(userId)) || Number(userId) <= 0) {
      throw new AppError('userId must be a positive integer.', 400);
    }

    console.log(`[FORCE_LOGOUT_REQUEST] Forcing logout for user ${userId}, request ${requestId}`);

    const result = await usageService.forceLogoutUser({
      requestId: Number(requestId),
      userId: Number(userId)
    });

    res.status(200).json({
      success: false, // Intentionally false to indicate user is blocked
      message: result.message,
      data: {
        sessionsClosedCount: result.sessionsClosedCount,
        blockedUntil: result.blockedUntil
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  startUsageSession,
  endUsageSession,
  getUsageStatus,
  getActiveSessions,
  forceLogout
};
