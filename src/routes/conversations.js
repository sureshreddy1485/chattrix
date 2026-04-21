const express = require('express');
const router = express.Router();
const {
  getConversations,
  createOrGetConversation,
  deleteConversation,
  createGroupConversation,
  kickMember,
  makeAdmin,
  revokeAdmin,
  searchGroups,
  updateGroup,
  muteConversation,
  unmuteConversation,
  pinConversation,
  unpinConversation,
  addMembers,
  leaveGroup,
  updateDmSetting,
  checkDmAllowed,
  bulkDeleteConversations,
} = require('../controllers/conversationController');
const { authenticate } = require('../middleware/auth');
const { uploadAvatar } = require('../config/cloudinary');

router.use(authenticate);

router.get('/', getConversations);
router.get('/search/group', searchGroups);
router.post('/', createOrGetConversation);
router.post('/group', uploadAvatar, createGroupConversation);
router.delete('/bulk', bulkDeleteConversations);
router.delete('/:id', deleteConversation);
router.put('/:id/kick', kickMember);
router.put('/:id/admin', makeAdmin);
router.put('/:id/revoke-admin', revokeAdmin);
router.put('/:id/update', uploadAvatar, updateGroup);
router.put('/:id/mute', muteConversation);
router.put('/:id/unmute', unmuteConversation);
router.put('/:id/pin', pinConversation);
router.put('/:id/unpin', unpinConversation);
router.put('/:id/members/add', addMembers);
router.put('/:id/leave', leaveGroup);
router.put('/:id/dm-setting', updateDmSetting);
router.get('/:id/dm-allowed/:userId', checkDmAllowed);

module.exports = router;
