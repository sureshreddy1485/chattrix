const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const { decrypt, encrypt } = require('../utils/encryption');
const { getIo } = require('../utils/ioInstance');
const { broadcastSystemMessage } = require('../socket/socketHandler');

// ── Helper: create and broadcast a system event message ──────────────────────
const createSystemMessage = async (conversationId, action, actorId, actorName, targetId = null, targetName = null) => {
  const content = 'System Event';
  const encryptedContent = encrypt(content);
  const msg = await Message.create({
    conversationId,
    senderId: actorId,
    content,
    encryptedContent,
    type: 'system',
    systemEvent: { action, actorId, targetId, actorName, targetName },
  });
  console.log(`[SYSTEM_MSG] Created ${action} for group ${conversationId}`);
  await Conversation.findByIdAndUpdate(conversationId, {
    lastMessage: msg._id,
    updatedAt: new Date(),
  });
  // Broadcast to all online group members in real-time
  const io = getIo();
  if (io) {
    console.log(`[SYSTEM_MSG] Broadcasting ${action} to group room`);
    await broadcastSystemMessage(io, conversationId, msg);
  }
  return msg;
};


// GET /api/conversations — list all user's conversations with last message
const getConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({ participants: req.user._id })
      .populate('participants', 'username displayName avatar isOnline lastSeen createdAt bio interests')
      .populate({
        path: 'lastMessage',
        populate: { path: 'senderId', select: 'username displayName' },
      })
      .sort({ updatedAt: -1 });

    // Decrypt last message content for preview
    const result = conversations.map((conv) => {
      const obj = conv.toObject();
      if (obj.lastMessage?.encryptedContent) {
        try {
          obj.lastMessage.content = decrypt(obj.lastMessage.encryptedContent);
        } catch {
          obj.lastMessage.content = '...';
        }
        delete obj.lastMessage.encryptedContent;
      }
      // Add unread count for current user
      obj.myUnreadCount = conv.unreadCount.get(req.user._id.toString()) || 0;
      return obj;
    });

    res.json(result);
  } catch (err) {
    console.error('getConversations error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// POST /api/conversations — create or get existing 1-on-1 conversation
const createOrGetConversation = async (req, res) => {
  try {
    const { participantId } = req.body;
    if (!participantId) return res.status(400).json({ message: 'participantId required' });

    const myId = req.user._id.toString();
    const theirId = participantId.toString();

    // Check if conversation already exists between these two users
    let conversation = await Conversation.findOne({
      isGroup: false,
      participants: { $all: [myId, theirId], $size: 2 },
    }).populate('participants', 'username displayName avatar isOnline lastSeen createdAt bio interests');

    if (!conversation) {
      conversation = await Conversation.create({
        participants: [myId, theirId],
        createdBy: myId,
      });
      conversation = await conversation.populate(
        'participants',
        'username displayName avatar isOnline lastSeen createdAt bio interests'
      );
    }

    res.json(conversation);
  } catch (err) {
    console.error('createConversation error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// DELETE /api/conversations/:id — delete conversation for this user only
const deleteConversation = async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      participants: req.user._id,
    });
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });

    // Remove user from participants (soft delete) or remove conversation if last participant
    if (conversation.participants.length <= 1) {
      await Conversation.findByIdAndDelete(req.params.id);
      await Message.deleteMany({ conversationId: req.params.id });
    } else {
      conversation.participants = conversation.participants.filter(
        (p) => p.toString() !== req.user._id.toString()
      );
      await conversation.save();
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

// POST /api/conversations/group — create a group conversation
const createGroupConversation = async (req, res) => {
  try {
    let { groupName, groupUsername, participantIds } = req.body;

    // Handle participantIds if sent as stringified JSON (from FormData)
    if (typeof participantIds === 'string') {
      try {
        participantIds = JSON.parse(participantIds);
      } catch (err) {
        participantIds = null;
      }
    }

    if (!groupName || !groupUsername || !participantIds || !Array.isArray(participantIds) || participantIds.length < 1) {
      return res.status(400).json({ message: 'Valid groupName, groupUsername, and at least one participant required' });
    }

    const myId = req.user._id.toString();
    const allParticipantIds = [...new Set([myId, ...participantIds])];

    // Check if groupUsername is taken
    const existingUsername = await Conversation.findOne({ groupUsername: groupUsername.trim().toLowerCase() });
    if (existingUsername) {
      return res.status(400).json({ message: 'Group username is already taken' });
    }

    let conversation = await Conversation.create({
      participants: allParticipantIds,
      isGroup: true,
      groupName: groupName.trim(),
      groupUsername: groupUsername.trim().toLowerCase(),
      groupAvatar: req.file ? req.file.path : null,
      createdBy: myId,
      admins: [myId],
    });

    // System message: group created
    const actorName = req.user.displayName || req.user.username;
    await createSystemMessage(conversation._id, 'created', myId, actorName, null, groupName.trim());

    conversation = await conversation.populate(
      'participants',
      'username displayName avatar isOnline lastSeen interests'
    );

    res.json(conversation);
  } catch (err) {
    console.error('createGroupConversation error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/conversations/:id/kick — Kick a member
const kickMember = async (req, res) => {
  try {
    const { id } = req.params;
    const { targetUserId } = req.body;

    if (!targetUserId) return res.status(400).json({ message: 'targetUserId required' });

    const conversation = await Conversation.findById(id);
    if (!conversation || !conversation.isGroup) return res.status(404).json({ message: 'Group not found' });

    const requesterId = req.user._id.toString();
    const isOwner = conversation.createdBy.toString() === requesterId;
    const isAdmin = conversation.admins.map(id => id.toString()).includes(requesterId);
    const isTargetOwner = conversation.createdBy.toString() === targetUserId;

    if (!isOwner && !isAdmin) return res.status(403).json({ message: 'Insufficient admin rights' });
    if (isTargetOwner) return res.status(403).json({ message: 'Cannot kick the Owner' });

    conversation.participants = conversation.participants.filter(p => p.toString() !== targetUserId);
    conversation.admins = conversation.admins.filter(a => a.toString() !== targetUserId);
    await conversation.save();

    // System message: actor removed target
    const target = await User.findById(targetUserId).select('displayName username');
    const actorName = req.user.displayName || req.user.username;
    const targetName = target?.displayName || target?.username || 'Someone';
    const sysMsg = await createSystemMessage(id, 'removed', requesterId, actorName, targetUserId, targetName);

    res.json({ success: true, systemMessage: sysMsg });
  } catch(err) {
    console.error('kickMember Error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/conversations/:id/admin — Make Admin
const makeAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { targetUserId } = req.body;

    if (!targetUserId) return res.status(400).json({ message: 'targetUserId required' });

    const conversation = await Conversation.findById(id);
    if (!conversation || !conversation.isGroup) return res.status(404).json({ message: 'Group not found' });

    const requesterId = req.user._id.toString();
    const isOwner = conversation.createdBy.toString() === requesterId;
    const isAdmin = conversation.admins.map(id => id.toString()).includes(requesterId);

    if (!isOwner && !isAdmin) return res.status(403).json({ message: 'Only Admins or Owners can promote' });

    if (!conversation.admins.map(a => a.toString()).includes(targetUserId)) {
      conversation.admins.push(targetUserId);
      await conversation.save();
    }

    // System message: actor promoted target
    const target = await User.findById(targetUserId).select('displayName username');
    const actorName = req.user.displayName || req.user.username;
    const targetName = target?.displayName || target?.username || 'Someone';
    const sysMsg = await createSystemMessage(id, 'promoted', requesterId, actorName, targetUserId, targetName);

    res.json({ success: true, systemMessage: sysMsg });
  } catch(err) {
    console.error('makeAdmin Error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/conversations/:id/revoke-admin — Revoke admin
const revokeAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { targetUserId } = req.body;

    if (!targetUserId) return res.status(400).json({ message: 'targetUserId required' });

    const conversation = await Conversation.findById(id);
    if (!conversation || !conversation.isGroup) return res.status(404).json({ message: 'Group not found' });

    const requesterId = req.user._id.toString();
    const isOwner = conversation.createdBy.toString() === requesterId;

    if (!isOwner) return res.status(403).json({ message: 'Only Owners can revoke admins' });

    conversation.admins = conversation.admins.filter(a => a.toString() !== targetUserId);
    await conversation.save();

    // System message: actor demoted target
    const target = await User.findById(targetUserId).select('displayName username');
    const actorName = req.user.displayName || req.user.username;
    const targetName = target?.displayName || target?.username || 'Someone';
    const sysMsg = await createSystemMessage(id, 'demoted', requesterId, actorName, targetUserId, targetName);

    res.json({ success: true, systemMessage: sysMsg });
  } catch(err) {
    console.error('revokeAdmin Error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// GET /api/conversations/search/group?q=username
const searchGroups = async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.json([]);

    const groups = await Conversation.find({
      isGroup: true,
      groupUsername: { $regex: query, $options: 'i' }
    }).select('groupName groupUsername groupAvatar participants createdBy admins');

    const result = groups.map(g => {
      const obj = g.toObject();
      obj.memberCount = g.participants.length;
      return obj;
    });

    res.json(result);
  } catch(err) {
    console.error('searchGroups error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/conversations/:id/update — update group name, description, avatar
const updateGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { groupName, groupDescription, groupAvatar } = req.body;

    const conversation = await Conversation.findById(id);
    if (!conversation || !conversation.isGroup) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const requesterId = req.user._id.toString();
    const isOwner = conversation.createdBy.toString() === requesterId;
    const isAdmin = conversation.admins.map(a => a.toString()).includes(requesterId);

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: 'Only admins can update group details' });
    }

    const oldName = conversation.groupName;
    const nameChanged = groupName !== undefined && groupName.trim() !== oldName;
    const avatarChanged = !!req.file;

    if (groupName !== undefined) conversation.groupName = groupName.trim().slice(0, 50);
    if (groupDescription !== undefined) conversation.groupDescription = groupDescription.trim().slice(0, 300);
    
    if (req.file) {
      conversation.groupAvatar = req.file.path;
    } else if (groupAvatar !== undefined) {
      conversation.groupAvatar = groupAvatar;
    }

    await conversation.save();

    const updated = await Conversation.findById(id).populate(
      'participants', 'username displayName avatar isOnline lastSeen interests'
    );

    // ── Real-time Updates ───────────────────────────────────────────────
    const io = getIo();
    const actorName = req.user.displayName || req.user.username;

    if (nameChanged) {
      const msg = await createSystemMessage(id, 'renamed', requesterId, actorName, null, conversation.groupName);
      broadcastSystemMessage(io, id, msg);
    }

    if (avatarChanged) {
      const msg = await createSystemMessage(id, 'updated_avatar', requesterId, actorName, null, 'group picture');
      broadcastSystemMessage(io, id, msg);
    }

    // Notify all participants to refresh their chat list/UI
    io.to(id).emit('conversation:updated', updated);

    res.json(updated);
  } catch (err) {
    console.error('updateGroup error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/conversations/:id/mute
const muteConversation = async (req, res) => {
  try {
    const conversation = await Conversation.findOneAndUpdate(
      { _id: req.params.id, participants: req.user._id },
      { $addToSet: { mutedBy: req.user._id } },
      { new: true }
    );
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
    res.json({ success: true, muted: true });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/conversations/:id/unmute
const unmuteConversation = async (req, res) => {
  try {
    const conversation = await Conversation.findOneAndUpdate(
      { _id: req.params.id, participants: req.user._id },
      { $pull: { mutedBy: req.user._id } },
      { new: true }
    );
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
    res.json({ success: true, muted: false });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/conversations/:id/members/add — add members (or self-join)
const addMembers = async (req, res) => {
  try {
    const { id } = req.params;
    const { userIds } = req.body;

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ message: 'userIds array required' });
    }

    const conversation = await Conversation.findById(id);
    if (!conversation || !conversation.isGroup) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const requesterId = req.user._id.toString();
    const isSelfJoin = userIds.length === 1 && userIds[0] === requesterId;
    const isOwner = conversation.createdBy.toString() === requesterId;
    const isAdmin = conversation.admins.map(a => a.toString()).includes(requesterId);

    if (!isOwner && !isAdmin && !isSelfJoin) {
      return res.status(403).json({ message: 'Only admins can add members' });
    }

    const addedUsers = [];
    for (const uid of userIds) {
      if (!conversation.participants.map(p => p.toString()).includes(uid)) {
        conversation.participants.push(uid);
        addedUsers.push(uid);
      }
    }

    await conversation.save();

    // Create system messages for each newly added user
    const sysMsgs = [];
    const actorName = req.user.displayName || req.user.username;

    for (const uid of addedUsers) {
      let action, targetName;
      if (isSelfJoin) {
        // Self-join: "X joined the group"
        action = 'joined';
        targetName = actorName;
        const sysMsg = await createSystemMessage(id, action, requesterId, actorName, uid, targetName);
        sysMsgs.push(sysMsg);
      } else {
        // Admin added: "X added Y"
        action = 'added';
        const target = await User.findById(uid).select('displayName username');
        targetName = target?.displayName || target?.username || 'Someone';
        const sysMsg = await createSystemMessage(id, action, requesterId, actorName, uid, targetName);
        sysMsgs.push(sysMsg);
      }
    }

    const updated = await Conversation.findById(id).populate(
      'participants', 'username displayName avatar isOnline lastSeen interests'
    );

    res.json({ ...updated.toObject(), systemMessages: sysMsgs });
  } catch (err) {
    console.error('addMembers error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/conversations/:id/leave — leave a group
const leaveGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const conversation = await Conversation.findById(id);

    if (!conversation || !conversation.isGroup) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const requesterId = req.user._id.toString();
    const isOwner = conversation.createdBy.toString() === requesterId;

    if (isOwner) {
      const nextAdmin = conversation.admins.find(a => a.toString() !== requesterId);
      const nextMember = conversation.participants.find(p => p.toString() !== requesterId);
      const newOwner = nextAdmin || nextMember;

      if (!newOwner) {
        await Conversation.findByIdAndDelete(id);
        return res.json({ success: true, deleted: true });
      }

      conversation.createdBy = newOwner;
      if (!conversation.admins.map(a => a.toString()).includes(newOwner.toString())) {
        conversation.admins.push(newOwner);
      }
    }

    // System message: X left the group
    const actorName = req.user.displayName || req.user.username;
    await createSystemMessage(id, 'left', requesterId, actorName, requesterId, actorName);

    conversation.participants = conversation.participants.filter(p => p.toString() !== requesterId);
    conversation.admins = conversation.admins.filter(a => a.toString() !== requesterId);

    if (conversation.participants.length === 0) {
      await Conversation.findByIdAndDelete(id);
      return res.json({ success: true, deleted: true });
    }

    await conversation.save();
    res.json({ success: true, deleted: false });
  } catch (err) {
    console.error('leaveGroup error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/conversations/:id/dm-setting — toggle DM preference for current user in this group
const updateDmSetting = async (req, res) => {
  try {
    const { id } = req.params;
    const { allowDm } = req.body;

    if (typeof allowDm !== 'boolean') {
      return res.status(400).json({ message: 'allowDm (boolean) required' });
    }

    const userId = req.user._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Upsert the groupDmSetting entry
    const idx = user.groupDmSettings.findIndex(s => s.groupId.toString() === id);
    if (idx > -1) {
      user.groupDmSettings[idx].allowDm = allowDm;
    } else {
      user.groupDmSettings.push({ groupId: id, allowDm });
    }
    await user.save();

    res.json({ success: true, allowDm });
  } catch (err) {
    console.error('updateDmSetting error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// GET /api/conversations/:id/dm-allowed/:userId — check if user allows DMs in this group
const checkDmAllowed = async (req, res) => {
  try {
    const { id: groupId, userId: targetUserId } = req.params;

    const target = await User.findById(targetUserId).select('groupDmSettings username');
    if (!target) return res.status(404).json({ message: 'User not found' });

    const setting = target.groupDmSettings.find(s => s.groupId.toString() === groupId);
    // Default is true (allow) if no setting exists
    const allowDm = setting ? setting.allowDm : true;

    res.json({ allowDm, username: target.username });
  } catch (err) {
    console.error('checkDmAllowed error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/conversations/:id/pin
const pinConversation = async (req, res) => {
  try {
    const conversation = await Conversation.findOneAndUpdate(
      { _id: req.params.id, participants: req.user._id },
      { $addToSet: { pinnedBy: req.user._id } },
      { new: true }
    ).populate('participants', 'username displayName avatar isOnline lastSeen interests');
    
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
    res.json(conversation);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/conversations/:id/unpin
const unpinConversation = async (req, res) => {
  try {
    const conversation = await Conversation.findOneAndUpdate(
      { _id: req.params.id, participants: req.user._id },
      { $pull: { pinnedBy: req.user._id } },
      { new: true }
    ).populate('participants', 'username displayName avatar isOnline lastSeen interests');
    
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
    res.json(conversation);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

// DELETE /api/conversations/bulk — delete multiple conversations
const bulkDeleteConversations = async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) {
      return res.status(400).json({ message: 'ids array required' });
    }

    const userId = req.user._id.toString();

    for (const id of ids) {
      try {
        if (!mongoose.Types.ObjectId.isValid(id)) continue;

        const conversation = await Conversation.findOne({ _id: id, participants: req.user._id });
        if (conversation) {
          if (conversation.participants.length <= 1) {
            await Conversation.findByIdAndDelete(id);
            await Message.deleteMany({ conversationId: id });
          } else {
            conversation.participants = conversation.participants.filter(
              (p) => p.toString() !== userId
            );
            await conversation.save();
          }
        }
      } catch (innerErr) {
        console.error(`Error deleting conversation ${id}:`, innerErr);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('bulkDeleteConversations error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getConversations,
  createOrGetConversation,
  deleteConversation,
  bulkDeleteConversations,
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
};
