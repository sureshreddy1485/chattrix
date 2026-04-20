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
  addMembers,
  leaveGroup,
} = require('../controllers/conversationController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/', getConversations);
router.get('/search/group', searchGroups);
router.post('/', createOrGetConversation);
router.post('/group', createGroupConversation);
router.delete('/:id', deleteConversation);
router.put('/:id/kick', kickMember);
router.put('/:id/admin', makeAdmin);
router.put('/:id/revoke-admin', revokeAdmin);
router.put('/:id/update', updateGroup);
router.put('/:id/mute', muteConversation);
router.put('/:id/unmute', unmuteConversation);
router.put('/:id/members/add', addMembers);
router.put('/:id/leave', leaveGroup);

module.exports = router;
