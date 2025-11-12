const express = require('express');
const router = express.Router();
const { logLoginAttempt, detectSuspiciousActivity } = require('../service/loginTracking');

// Login page
router.get('/login', (req, res) => {
  res.render('login', {
    pageTitle: 'Login',
    activePage: 'login'
  });
});

// Handle login form
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Check for suspicious activity before processing login
    if (email) {
      const suspiciousActivity = await detectSuspiciousActivity(email, 15);
      if (suspiciousActivity.isSuspicious) {
        console.log(`[Security] Suspicious login activity detected for ${email}:`, suspiciousActivity.details);
        // You can add additional security measures here (e.g., CAPTCHA, temporary lockout)
      }
    }

    // Validate credentials
    if (email.endsWith('@blueoshan.com') && password === '54321') {
      // Log successful login
      await logLoginAttempt({
        email,
        success: true
      }, req);

      req.session.user = email;
      return res.redirect('/');
    }

    // Log failed login attempt
    await logLoginAttempt({
      email: email || 'unknown',
      success: false,
      failureReason: 'Invalid email or password'
    }, req);

    res.render('login', {
      pageTitle: 'Login',
      activePage: 'login',
      error: 'Login failed: Invalid email or password',
      email: email
    });
  } catch (error) {
    console.error('[Auth] Error during login:', error);

    // Still render the login error even if tracking fails
    res.render('login', {
      pageTitle: 'Login',
      activePage: 'login',
      error: 'Login failed: Invalid email or password',
      email: email
    });
  }
});

// Logout route
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
