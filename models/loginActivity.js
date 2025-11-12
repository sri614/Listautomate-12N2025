const mongoose = require('mongoose');

const LoginActivitySchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    index: true // Index for faster queries
  },
  loginTime: {
    type: Date,
    default: Date.now,
    index: true // Index for date range queries
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  },
  status: {
    type: String,
    enum: ['success', 'failed'],
    required: true
  },
  failureReason: {
    type: String
  },
  // Additional security tracking fields
  sessionId: {
    type: String
  },
  location: {
    country: String,
    city: String,
    timezone: String
  }
});

// Compound index for querying by email and date range
LoginActivitySchema.index({ email: 1, loginTime: -1 });

const LoginActivity = mongoose.model('LoginActivity', LoginActivitySchema);
module.exports = LoginActivity;
