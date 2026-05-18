const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { uploadAvatar } = require('../config/cloudinary');
const {
  searchUsers,
  getUserById,
  updateProfile,
  getContacts,
  addContact,
  removeContact,
  savePushToken,
  blockUser,
  unblockUser,
  getBlockedUsers,
  deleteAccount,
} = require('../controllers/userController');

router.use(authenticate); // all user routes require auth

router.get('/search', searchUsers);
router.get('/blocked', getBlockedUsers);
router.get('/contacts', getContacts);
router.post('/contacts/add', addContact);
router.delete('/contacts/:id', removeContact);
router.put('/push-token', savePushToken);
router.get('/:id', getUserById);
router.put('/profile', uploadAvatar, updateProfile);
router.post('/block/:id', blockUser);
router.delete('/block/:id', unblockUser);
router.delete('/profile', deleteAccount);

module.exports = router;
