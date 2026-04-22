const jwt = require('jsonwebtoken');
const { body } = require('express-validator');
const User = require('../models/User');
const { validate } = require('../middleware/validate');

const generateToken = (userId) =>
  jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '90d' });

// ── Validation Chains ────────────────────────────────────────────────────────
const signupValidation = [
  body('username')
    .trim()
    .isLength({ min: 6, max: 20 })
    .withMessage('Username must be 6–20 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail()
    .custom((value) => {
      if (!value.endsWith('@gmail.com')) {
        throw new Error('Only Gmail addresses are accepted at this time');
      }
      return true;
    }),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&#)'),
  body('displayName').optional().trim().isLength({ max: 50 }),
  validate,
];

const loginValidation = [
  body('email').notEmpty().withMessage('Email or username required'),
  body('password').notEmpty().withMessage('Password required'),
  validate,
];

// ── Controllers ───────────────────────────────────────────────────────────────
const signup = async (req, res) => {
  try {
    const { username, email, password, displayName, secretPin } = req.body;

    if (!secretPin || secretPin.length < 4) {
      return res.status(400).json({ message: 'Secret PIN (min 4 digits) is required for recovery' });
    }

    // Check uniqueness
    const existingUsername = await User.findOne({ username: username.toLowerCase() });
    if (existingUsername) {
      return res.status(409).json({ message: 'Username already taken' });
    }

    const existingEmail = await User.findOne({ email: email.toLowerCase() });
    if (existingEmail) {
      return res.status(409).json({ message: 'Email already in use' });
    }

    const user = await User.create({
      username: username.toLowerCase(),
      email: email.toLowerCase(),
      displayName: displayName?.trim() || username,
      passwordHash: password,
      secretPin,
    });

    const token = generateToken(user._id);
    res.status(201).json({ token, user });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const identifier = email.trim().toLowerCase();

    const user = await User.findOne({
      $or: [{ email: identifier }, { username: identifier }]
    }).select('+passwordHash');
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = generateToken(user._id);
    const userObj = user.toJSON();
    res.json({ token, user: userObj });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

const getMe = async (req, res) => {
  res.json(req.user);
};

const refreshToken = async (req, res) => {
  try {
    const newToken = generateToken(req.user._id);
    res.json({ token: newToken });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

const updatePushToken = async (req, res) => {
  try {
    const { pushToken } = req.body;
    await User.findByIdAndUpdate(req.user._id, { pushToken });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new passwords are required' });
    }
    
    // Check new password complexity manually here too just in case
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({ message: 'New password must contain uppercase, lowercase, number and special character' });
    }

    const user = await User.findById(req.user._id).select('+passwordHash');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({ message: 'Incorrect current password' });
    }

    user.passwordHash = newPassword;
    await user.save();

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.json({ message: 'If an account exists, instructions were sent.' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetPasswordOTP = otp;
    user.resetPasswordExpires = Date.now() + 15 * 60 * 1000;
    await user.save();

    console.log('\n=======================================');
    console.log(`🔐 PASSWORD RESET FOR ${user.email} 🔐`);
    console.log(`OTP (Legacy): ${otp}`);
    console.log(`NOTE: User can also use their Secret PIN to reset.`);
    console.log('=======================================\n');

    res.json({ message: 'Password reset initiated. Use your OTP or Secret PIN to proceed.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { email, otp, pin, newPassword } = req.body;
    if (!email || (!otp && !pin) || !newPassword) {
      return res.status(400).json({ message: 'Email, recovery code (OTP/PIN), and new password are required' });
    }

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({ message: 'New password must contain uppercase, lowercase, number and special character' });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select('+resetPasswordOTP +resetPasswordExpires +secretPin +passwordHash');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Verify recovery code
    let isValid = false;
    if (otp && user.resetPasswordOTP === otp && user.resetPasswordExpires > Date.now()) {
      isValid = true;
    } else if (pin && user.secretPin === pin) {
      isValid = true;
    }

    if (!isValid) {
      return res.status(400).json({ message: 'Invalid or expired recovery code/PIN' });
    }

    user.passwordHash = newPassword;
    user.resetPasswordOTP = null;
    user.resetPasswordExpires = null;
    await user.save();

    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { signup, login, getMe, refreshToken, updatePushToken, changePassword, forgotPassword, resetPassword, signupValidation, loginValidation };

