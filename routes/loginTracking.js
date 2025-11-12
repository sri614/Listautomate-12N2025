const express = require('express');
const router = express.Router();
const {
  getLoginHistory,
  getLoginStats,
  getAllLoginActivity
} = require('../service/loginTracking');

// Authentication middleware
function ensureAuthenticated(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

/**
 * Get login history for the currently logged-in user
 * GET /api/login-tracking/my-history
 * Query params: limit, startDate, endDate, status
 */
router.get('/my-history', ensureAuthenticated, async (req, res) => {
  try {
    const email = req.session.user;
    const { limit, startDate, endDate, status } = req.query;

    const options = {};
    if (limit) options.limit = parseInt(limit);
    if (startDate) options.startDate = startDate;
    if (endDate) options.endDate = endDate;
    if (status) options.status = status;

    const history = await getLoginHistory(email, options);

    res.json({
      success: true,
      email,
      count: history.length,
      history
    });
  } catch (error) {
    console.error('[Login Tracking API] Error fetching user history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch login history'
    });
  }
});

/**
 * Get login statistics for the currently logged-in user
 * GET /api/login-tracking/my-stats
 * Query params: days (default: 30)
 */
router.get('/my-stats', ensureAuthenticated, async (req, res) => {
  try {
    const email = req.session.user;
    const days = req.query.days ? parseInt(req.query.days) : 30;

    const stats = await getLoginStats(email, days);

    res.json({
      success: true,
      email,
      period: `Last ${days} days`,
      stats
    });
  } catch (error) {
    console.error('[Login Tracking API] Error fetching user stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch login statistics'
    });
  }
});

/**
 * Get login history for a specific user (admin only - restrict as needed)
 * GET /api/login-tracking/history/:email
 * Query params: limit, startDate, endDate, status
 */
router.get('/history/:email', ensureAuthenticated, async (req, res) => {
  try {
    const targetEmail = req.params.email;
    const { limit, startDate, endDate, status } = req.query;

    const options = {};
    if (limit) options.limit = parseInt(limit);
    if (startDate) options.startDate = startDate;
    if (endDate) options.endDate = endDate;
    if (status) options.status = status;

    const history = await getLoginHistory(targetEmail, options);

    res.json({
      success: true,
      email: targetEmail,
      count: history.length,
      history
    });
  } catch (error) {
    console.error('[Login Tracking API] Error fetching history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch login history'
    });
  }
});

/**
 * Get login statistics for a specific user (admin only - restrict as needed)
 * GET /api/login-tracking/stats/:email
 * Query params: days (default: 30)
 */
router.get('/stats/:email', ensureAuthenticated, async (req, res) => {
  try {
    const targetEmail = req.params.email;
    const days = req.query.days ? parseInt(req.query.days) : 30;

    const stats = await getLoginStats(targetEmail, days);

    res.json({
      success: true,
      email: targetEmail,
      period: `Last ${days} days`,
      stats
    });
  } catch (error) {
    console.error('[Login Tracking API] Error fetching stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch login statistics'
    });
  }
});

/**
 * Get all login activity (admin only - restrict as needed)
 * GET /api/login-tracking/all
 * Query params: limit, startDate, endDate
 */
router.get('/all', ensureAuthenticated, async (req, res) => {
  try {
    const { limit, startDate, endDate } = req.query;

    const options = {};
    if (limit) options.limit = parseInt(limit);
    if (startDate) options.startDate = startDate;
    if (endDate) options.endDate = endDate;

    const activity = await getAllLoginActivity(options);

    // Group by email for summary
    const emailSummary = {};
    activity.forEach(record => {
      if (!emailSummary[record.email]) {
        emailSummary[record.email] = {
          totalAttempts: 0,
          successfulLogins: 0,
          failedAttempts: 0,
          lastActivity: null
        };
      }

      emailSummary[record.email].totalAttempts++;
      if (record.status === 'success') {
        emailSummary[record.email].successfulLogins++;
      } else {
        emailSummary[record.email].failedAttempts++;
      }

      if (!emailSummary[record.email].lastActivity ||
          record.loginTime > emailSummary[record.email].lastActivity) {
        emailSummary[record.email].lastActivity = record.loginTime;
      }
    });

    res.json({
      success: true,
      totalRecords: activity.length,
      uniqueUsers: Object.keys(emailSummary).length,
      summary: emailSummary,
      recentActivity: activity.slice(0, 50) // Return most recent 50 for details
    });
  } catch (error) {
    console.error('[Login Tracking API] Error fetching all activity:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch login activity'
    });
  }
});

module.exports = router;
