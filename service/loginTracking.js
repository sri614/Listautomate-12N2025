const LoginActivity = require('../models/loginActivity');

/**
 * Log a login attempt (successful or failed)
 * @param {Object} loginData - Login attempt data
 * @param {string} loginData.email - User's email address
 * @param {boolean} loginData.success - Whether login was successful
 * @param {string} [loginData.failureReason] - Reason for failure (if failed)
 * @param {Object} req - Express request object (for IP, user agent, etc.)
 * @returns {Promise<Object>} - Saved login activity record
 */
async function logLoginAttempt(loginData, req) {
  try {
    const { email, success, failureReason } = loginData;

    // Extract IP address (handle proxies/load balancers)
    const ipAddress = req.headers['x-forwarded-for']?.split(',')[0].trim() ||
                      req.headers['x-real-ip'] ||
                      req.connection.remoteAddress ||
                      req.socket.remoteAddress;

    // Extract user agent
    const userAgent = req.headers['user-agent'];

    // Create login activity record
    const loginActivity = new LoginActivity({
      email,
      loginTime: new Date(),
      ipAddress,
      userAgent,
      status: success ? 'success' : 'failed',
      failureReason: success ? null : failureReason,
      sessionId: req.session?.id || null
    });

    await loginActivity.save();

    console.log(`[Login Tracking] ${success ? 'Successful' : 'Failed'} login attempt for ${email} from ${ipAddress}`);

    return loginActivity;
  } catch (error) {
    console.error('[Login Tracking] Error logging login attempt:', error);
    // Don't throw error - we don't want login tracking to break the login process
    return null;
  }
}

/**
 * Get login history for a specific email
 * @param {string} email - User's email address
 * @param {Object} [options] - Query options
 * @param {number} [options.limit=50] - Maximum number of records to return
 * @param {Date} [options.startDate] - Start date for filtering
 * @param {Date} [options.endDate] - End date for filtering
 * @param {string} [options.status] - Filter by status (success/failed)
 * @returns {Promise<Array>} - Array of login activity records
 */
async function getLoginHistory(email, options = {}) {
  try {
    const { limit = 50, startDate, endDate, status } = options;

    const query = { email };

    // Add date range filter if provided
    if (startDate || endDate) {
      query.loginTime = {};
      if (startDate) query.loginTime.$gte = new Date(startDate);
      if (endDate) query.loginTime.$lte = new Date(endDate);
    }

    // Add status filter if provided
    if (status) {
      query.status = status;
    }

    const loginHistory = await LoginActivity.find(query)
      .sort({ loginTime: -1 })
      .limit(limit)
      .lean();

    return loginHistory;
  } catch (error) {
    console.error('[Login Tracking] Error fetching login history:', error);
    throw error;
  }
}

/**
 * Get login statistics for a specific email
 * @param {string} email - User's email address
 * @param {number} [days=30] - Number of days to analyze
 * @returns {Promise<Object>} - Login statistics
 */
async function getLoginStats(email, days = 30) {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const loginRecords = await LoginActivity.find({
      email,
      loginTime: { $gte: startDate }
    }).lean();

    const stats = {
      totalAttempts: loginRecords.length,
      successfulLogins: loginRecords.filter(r => r.status === 'success').length,
      failedAttempts: loginRecords.filter(r => r.status === 'failed').length,
      lastLoginTime: null,
      uniqueIPs: new Set(loginRecords.map(r => r.ipAddress).filter(Boolean)).size,
      recentActivity: loginRecords.slice(0, 10)
    };

    // Get last successful login
    const lastSuccess = loginRecords.find(r => r.status === 'success');
    if (lastSuccess) {
      stats.lastLoginTime = lastSuccess.loginTime;
    }

    return stats;
  } catch (error) {
    console.error('[Login Tracking] Error calculating login stats:', error);
    throw error;
  }
}

/**
 * Get all login activity for admin view
 * @param {Object} [options] - Query options
 * @param {number} [options.limit=100] - Maximum number of records to return
 * @param {Date} [options.startDate] - Start date for filtering
 * @param {Date} [options.endDate] - End date for filtering
 * @returns {Promise<Array>} - Array of login activity records
 */
async function getAllLoginActivity(options = {}) {
  try {
    const { limit = 100, startDate, endDate } = options;

    const query = {};

    // Add date range filter if provided
    if (startDate || endDate) {
      query.loginTime = {};
      if (startDate) query.loginTime.$gte = new Date(startDate);
      if (endDate) query.loginTime.$lte = new Date(endDate);
    }

    const loginActivity = await LoginActivity.find(query)
      .sort({ loginTime: -1 })
      .limit(limit)
      .lean();

    return loginActivity;
  } catch (error) {
    console.error('[Login Tracking] Error fetching all login activity:', error);
    throw error;
  }
}

/**
 * Detect suspicious login patterns (security feature)
 * @param {string} email - User's email address
 * @param {number} [minutes=15] - Time window to check
 * @returns {Promise<Object>} - Suspicious activity report
 */
async function detectSuspiciousActivity(email, minutes = 15) {
  try {
    const startTime = new Date();
    startTime.setMinutes(startTime.getMinutes() - minutes);

    const recentAttempts = await LoginActivity.find({
      email,
      loginTime: { $gte: startTime }
    }).lean();

    const suspiciousPatterns = {
      isHighFailureRate: false,
      multipleIPs: false,
      rapidAttempts: false,
      details: []
    };

    // Check for high failure rate
    const failedAttempts = recentAttempts.filter(r => r.status === 'failed').length;
    if (failedAttempts >= 3) {
      suspiciousPatterns.isHighFailureRate = true;
      suspiciousPatterns.details.push(`${failedAttempts} failed login attempts in ${minutes} minutes`);
    }

    // Check for multiple IPs
    const uniqueIPs = new Set(recentAttempts.map(r => r.ipAddress).filter(Boolean));
    if (uniqueIPs.size > 2) {
      suspiciousPatterns.multipleIPs = true;
      suspiciousPatterns.details.push(`Login attempts from ${uniqueIPs.size} different IP addresses`);
    }

    // Check for rapid attempts
    if (recentAttempts.length >= 5) {
      suspiciousPatterns.rapidAttempts = true;
      suspiciousPatterns.details.push(`${recentAttempts.length} login attempts in ${minutes} minutes`);
    }

    suspiciousPatterns.isSuspicious =
      suspiciousPatterns.isHighFailureRate ||
      suspiciousPatterns.multipleIPs ||
      suspiciousPatterns.rapidAttempts;

    return suspiciousPatterns;
  } catch (error) {
    console.error('[Login Tracking] Error detecting suspicious activity:', error);
    throw error;
  }
}

module.exports = {
  logLoginAttempt,
  getLoginHistory,
  getLoginStats,
  getAllLoginActivity,
  detectSuspiciousActivity
};
