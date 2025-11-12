/**
 * Login Tracking System - Example Usage
 *
 * This script demonstrates how to use the login tracking system
 * to query and analyze login activity.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const {
  getLoginHistory,
  getLoginStats,
  getAllLoginActivity,
  detectSuspiciousActivity
} = require('../service/loginTracking');

// Connect to database
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
}

// Example 1: Get login history for a specific user
async function example1_GetUserHistory() {
  console.log('\n=== Example 1: Get User Login History ===');

  const email = 'user@blueoshan.com'; // Replace with actual email

  const history = await getLoginHistory(email, {
    limit: 10,
    // startDate: '2025-11-01',
    // endDate: '2025-11-30',
    // status: 'success'
  });

  console.log(`Found ${history.length} login records for ${email}`);

  history.forEach((record, index) => {
    console.log(`\n${index + 1}. ${record.status.toUpperCase()}`);
    console.log(`   Time: ${new Date(record.loginTime).toLocaleString()}`);
    console.log(`   IP: ${record.ipAddress}`);
    if (record.failureReason) {
      console.log(`   Reason: ${record.failureReason}`);
    }
  });
}

// Example 2: Get login statistics
async function example2_GetUserStats() {
  console.log('\n=== Example 2: Get User Statistics ===');

  const email = 'user@blueoshan.com'; // Replace with actual email
  const days = 30;

  const stats = await getLoginStats(email, days);

  console.log(`\nStatistics for ${email} (Last ${days} days):`);
  console.log(`  Total Attempts: ${stats.totalAttempts}`);
  console.log(`  Successful Logins: ${stats.successfulLogins}`);
  console.log(`  Failed Attempts: ${stats.failedAttempts}`);
  console.log(`  Unique IPs: ${stats.uniqueIPs}`);

  if (stats.lastLoginTime) {
    console.log(`  Last Login: ${new Date(stats.lastLoginTime).toLocaleString()}`);
  }

  if (stats.failedAttempts > 0) {
    const successRate = ((stats.successfulLogins / stats.totalAttempts) * 100).toFixed(2);
    console.log(`  Success Rate: ${successRate}%`);
  }
}

// Example 3: Get all login activity (admin view)
async function example3_GetAllActivity() {
  console.log('\n=== Example 3: Get All Login Activity ===');

  const activity = await getAllLoginActivity({
    limit: 50,
    // startDate: '2025-11-01'
  });

  console.log(`\nTotal records: ${activity.length}`);

  // Group by email
  const summary = {};
  activity.forEach(record => {
    if (!summary[record.email]) {
      summary[record.email] = { success: 0, failed: 0, total: 0 };
    }
    summary[record.email].total++;
    if (record.status === 'success') {
      summary[record.email].success++;
    } else {
      summary[record.email].failed++;
    }
  });

  console.log('\nUser Summary:');
  Object.entries(summary).forEach(([email, stats]) => {
    console.log(`  ${email}:`);
    console.log(`    Total: ${stats.total}, Success: ${stats.success}, Failed: ${stats.failed}`);
  });

  console.log('\nMost Recent Activities:');
  activity.slice(0, 5).forEach((record, index) => {
    console.log(`  ${index + 1}. ${record.email} - ${record.status} - ${new Date(record.loginTime).toLocaleString()}`);
  });
}

// Example 4: Detect suspicious activity
async function example4_DetectSuspicious() {
  console.log('\n=== Example 4: Detect Suspicious Activity ===');

  const email = 'user@blueoshan.com'; // Replace with actual email
  const minutes = 15;

  const suspicious = await detectSuspiciousActivity(email, minutes);

  console.log(`\nChecking for suspicious activity for ${email} (Last ${minutes} minutes):`);
  console.log(`  Is Suspicious: ${suspicious.isSuspicious ? '⚠️ YES' : '✅ NO'}`);

  if (suspicious.isSuspicious) {
    console.log('\n  Warning Signs:');
    suspicious.details.forEach(detail => {
      console.log(`    - ${detail}`);
    });

    console.log('\n  Patterns Detected:');
    console.log(`    High Failure Rate: ${suspicious.isHighFailureRate ? '⚠️ YES' : 'NO'}`);
    console.log(`    Multiple IPs: ${suspicious.multipleIPs ? '⚠️ YES' : 'NO'}`);
    console.log(`    Rapid Attempts: ${suspicious.rapidAttempts ? '⚠️ YES' : 'NO'}`);
  }
}

// Example 5: Find users with recent failed logins
async function example5_FindFailedLogins() {
  console.log('\n=== Example 5: Find Recent Failed Logins ===');

  const LoginActivity = require('../models/loginActivity');

  const failedLogins = await LoginActivity.find({
    status: 'failed',
    loginTime: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
  })
  .sort({ loginTime: -1 })
  .limit(20)
  .lean();

  console.log(`\nFound ${failedLogins.length} failed login attempts in the last 24 hours:`);

  failedLogins.forEach((record, index) => {
    console.log(`\n${index + 1}. ${record.email}`);
    console.log(`   Time: ${new Date(record.loginTime).toLocaleString()}`);
    console.log(`   IP: ${record.ipAddress}`);
    console.log(`   Reason: ${record.failureReason || 'Unknown'}`);
  });

  // Group by email
  const emailCounts = {};
  failedLogins.forEach(record => {
    emailCounts[record.email] = (emailCounts[record.email] || 0) + 1;
  });

  console.log('\nFailed Attempts by Email:');
  Object.entries(emailCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([email, count]) => {
      console.log(`  ${email}: ${count} attempt(s)`);
    });
}

// Example 6: Analyze login patterns by time
async function example6_AnalyzeLoginPatterns() {
  console.log('\n=== Example 6: Analyze Login Patterns by Time ===');

  const LoginActivity = require('../models/loginActivity');

  const logins = await LoginActivity.find({
    status: 'success',
    loginTime: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
  })
  .lean();

  console.log(`\nAnalyzing ${logins.length} successful logins from the last 7 days:`);

  // Count by hour of day
  const hourCounts = Array(24).fill(0);
  logins.forEach(record => {
    const hour = new Date(record.loginTime).getHours();
    hourCounts[hour]++;
  });

  console.log('\nLogins by Hour of Day:');
  hourCounts.forEach((count, hour) => {
    if (count > 0) {
      const bar = '█'.repeat(Math.ceil(count / 2));
      console.log(`  ${hour.toString().padStart(2, '0')}:00 - ${bar} (${count})`);
    }
  });

  // Count by day of week
  const dayCounts = Array(7).fill(0);
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  logins.forEach(record => {
    const day = new Date(record.loginTime).getDay();
    dayCounts[day]++;
  });

  console.log('\nLogins by Day of Week:');
  dayCounts.forEach((count, day) => {
    if (count > 0) {
      const bar = '█'.repeat(Math.ceil(count / 2));
      console.log(`  ${dayNames[day].padEnd(9)} - ${bar} (${count})`);
    }
  });
}

// Main execution
async function main() {
  try {
    await connectDB();

    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║      Login Tracking System - Example Usage            ║');
    console.log('╚════════════════════════════════════════════════════════╝');

    // Run examples (comment out the ones you don't need)
    await example1_GetUserHistory();
    await example2_GetUserStats();
    await example3_GetAllActivity();
    await example4_DetectSuspicious();
    await example5_FindFailedLogins();
    await example6_AnalyzeLoginPatterns();

    console.log('\n✅ All examples completed successfully!');
    console.log('\nNote: Replace "user@blueoshan.com" with actual emails from your system.\n');

  } catch (error) {
    console.error('\n❌ Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Disconnected from MongoDB');
  }
}

// Run the script
main();
