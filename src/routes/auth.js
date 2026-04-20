const express = require('express');
const router = express.Router();
const { signup, login, getMe, updatePushToken, changePassword, forgotPassword, resetPassword, signupValidation, loginValidation } = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

router.post('/signup', signupValidation, signup);
router.post('/login', loginValidation, login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/me', authenticate, getMe);
router.put('/push-token', authenticate, updatePushToken);
router.put('/password', authenticate, changePassword);

module.exports = router;
