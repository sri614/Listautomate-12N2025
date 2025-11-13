const ClonedEmail = require('../models/clonedEmail');
const CreatedList = require('../models/list');

// Configuration - Keep only last 31 days of data
const RETENTION_DAYS = 31;

// Schedule configuration - Run daily at 2 AM
const cleanup_HOUR = 2; // 2 AM
const cleanup_MINUTE = 0; // On the hour
const CHECK_INTERVAL_MS = 60 * 1000; // Check every minute

let schedulerInterval = null;
let lastcleanupDate = null;

/**
 * Calculate the cutoff date for data retention
 * @returns {Date} Date object representing the cutoff (data older than this will be deleted)
 */
function getRetentionCutoffDate() {
  const now = new Date();
  const cutoffDate = new Date(now.getTime() - (RETENTION_DAYS * 24 * 60 * 60 * 1000));
  return cutoffDate;
}

/**
 * Delete cloned emails older than 31 days from MongoDB
 * @returns {Promise<Object>} Result with count of deleted documents
 */
async function cleanupOldClonedEmails() {
  try {
    const cutoffDate = getRetentionCutoffDate();

    const result = await ClonedEmail.deleteMany({
      createdAt: { $lt: cutoffDate }
    });

    console.log(`[Data Retention] Deleted ${result.deletedCount} cloned emails older than ${RETENTION_DAYS} days (before ${cutoffDate.toISOString()})`);

    return {
      success: true,
      deletedCount: result.deletedCount,
      cutoffDate: cutoffDate
    };
  } catch (error) {
    console.error('[Data Retention] Error cleaning up cloned emails:', error);
    return {
      success: false,
      error: error.message,
      deletedCount: 0
    };
  }
}

/**
 * Delete created lists older than 31 days from MongoDB
 * @returns {Promise<Object>} Result with count of deleted documents
 */
async function cleanupOldCreatedLists() {
  try {
    const cutoffDate = getRetentionCutoffDate();

    const result = await CreatedList.deleteMany({
      createdDate: { $lt: cutoffDate }
    });

    console.log(`[Data Retention] Deleted ${result.deletedCount} created lists older than ${RETENTION_DAYS} days (before ${cutoffDate.toISOString()})`);

    return {
      success: true,
      deletedCount: result.deletedCount,
      cutoffDate: cutoffDate
    };
  } catch (error) {
    console.error('[Data Retention] Error cleaning up created lists:', error);
    return {
      success: false,
      error: error.message,
      deletedCount: 0
    };
  }
}

/**
 * Run complete data retention cleanup for both emails and lists
 * @returns {Promise<Object>} Combined results from all cleanup operations
 */
async function runDataRetentioncleanup() {
  console.log(`[Data Retention] Starting cleanup - deleting data older than ${RETENTION_DAYS} days`);

  const results = {
    timestamp: new Date().toISOString(),
    retentionDays: RETENTION_DAYS,
    clonedEmails: await cleanupOldClonedEmails(),
    createdLists: await cleanupOldCreatedLists()
  };

  console.log('[Data Retention] cleanup completed:', {
    clonedEmailsDeleted: results.clonedEmails.deletedCount,
    createdListsDeleted: results.createdLists.deletedCount,
    totalDeleted: results.clonedEmails.deletedCount + results.createdLists.deletedCount
  });

  return results;
}

/**
 * Check if it's time to run cleanup (daily at 2 AM)
 * @returns {boolean} True if cleanup should run now
 */
function shouldRuncleanup() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentDate = now.toDateString();

  // Check if we're at the scheduled time
  const isScheduledTime = currentHour === cleanup_HOUR && currentMinute === cleanup_MINUTE;

  // Check if we haven't already run today
  const hasNotRunToday = lastcleanupDate !== currentDate;

  return isScheduledTime && hasNotRunToday;
}

/**
 * Initialize automatic daily data retention cleanup
 * Runs every day at 2 AM automatically
 */
function initializeAutocleanup() {
  if (schedulerInterval) {
    console.log('[Data Retention] Scheduler already running');
    return;
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log('🗑️  DATA RETENTION SERVICE - INITIALIZED');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`📅 Retention Policy: Keep only last ${RETENTION_DAYS} days of data`);
  console.log(`⏰ Schedule: Daily at ${cleanup_HOUR.toString().padStart(2, '0')}:${cleanup_MINUTE.toString().padStart(2, '0')} AM`);
  console.log(`🔄 Status: Automatic cleanup is ENABLED`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // Check every minute if it's time to run cleanup
  schedulerInterval = setInterval(async () => {
    if (shouldRuncleanup()) {
      const now = new Date();
      lastcleanupDate = now.toDateString();

      console.log('\n═══════════════════════════════════════════════════════════');
      console.log(`🕐 SCHEDULED cleanup STARTED - ${now.toISOString()}`);
      console.log('═══════════════════════════════════════════════════════════');

      try {
        const results = await runDataRetentioncleanup();

        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('✅ SCHEDULED cleanup COMPLETED');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`📧 Cloned Emails Deleted: ${results.clonedEmails.deletedCount}`);
        console.log(`📋 Created Lists Deleted: ${results.createdLists.deletedCount}`);
        console.log(`📊 Total Records Deleted: ${results.clonedEmails.deletedCount + results.createdLists.deletedCount}`);
        console.log(`📅 Next cleanup: Tomorrow at ${cleanup_HOUR.toString().padStart(2, '0')}:${cleanup_MINUTE.toString().padStart(2, '0')} AM`);
        console.log('═══════════════════════════════════════════════════════════\n');
      } catch (error) {
        console.error('\n❌ SCHEDULED cleanup FAILED:', error.message);
        console.error('Will retry tomorrow at scheduled time\n');
      }
    }
  }, CHECK_INTERVAL_MS);

  // Run cleanup immediately on first initialization (optional - you can remove if you don't want this)
  setTimeout(async () => {
    const now = new Date();
    const currentDate = now.toDateString();

    // Only run if we haven't run today yet
    if (lastcleanupDate !== currentDate) {
      console.log('\n═══════════════════════════════════════════════════════════');
      console.log('🚀 INITIAL cleanup STARTED (First run after server start)');
      console.log('═══════════════════════════════════════════════════════════');

      try {
        lastcleanupDate = currentDate;
        const results = await runDataRetentioncleanup();

        console.log('\n═══════════════════════════════════════════════════════════');
        console.log('✅ INITIAL cleanup COMPLETED');
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`📧 Cloned Emails Deleted: ${results.clonedEmails.deletedCount}`);
        console.log(`📋 Created Lists Deleted: ${results.createdLists.deletedCount}`);
        console.log(`📊 Total Records Deleted: ${results.clonedEmails.deletedCount + results.createdLists.deletedCount}`);
        console.log(`📅 Next cleanup: Tomorrow at ${cleanup_HOUR.toString().padStart(2, '0')}:${cleanup_MINUTE.toString().padStart(2, '0')} AM`);
        console.log('═══════════════════════════════════════════════════════════\n');
      } catch (error) {
        console.error('\n❌ INITIAL cleanup FAILED:', error.message);
      }
    }
  }, 5000); // Wait 5 seconds after server starts
}

/**
 * Stop the automatic cleanup scheduler
 */
function stopAutocleanup() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[Data Retention] ⏹️ Automatic cleanup stopped');
  }
}

module.exports = {
  runDataRetentioncleanup,
  cleanupOldClonedEmails,
  cleanupOldCreatedLists,
  getRetentionCutoffDate,
  initializeAutocleanup,
  stopAutocleanup,
  RETENTION_DAYS
};
