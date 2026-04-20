const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { decrypt } = require('../utils/encryption');

// GET /api/conversations — list all user's conversations with last message
const getConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({ participants: req.user._id })
      .populate('participants', 'username displayName avatar isOnline lastSeen')
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
    }).populate('participants', 'username displayName avatar isOnline lastSeen');

    if (!conversation) {
      conversation = await Conversation.create({
        participants: [myId, theirId],
        createdBy: myId,
      });
      conversation = await conversation.populate(
        'participants',
        'username displayName avatar isOnline lastSeen'
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
    const { groupName, groupUsername, participantIds } = req.body;
    if (!groupName || !groupUsername || !participantIds || !Array.isArray(participantIds) || participantIds.length < 1) {
      return res.status(400).json({ message: 'Valid groupName, groupUsername, and at least one participant required' });
    }

    const myId = req.user._id.toString();
    const allParticipantIds = [...new Set([myId, ...participantIds])];

    // Check if groupUsername is taken
    const existingUsername = await Conversation.findOne({ groupUsername: groupUsername.trim().toLowerCase() });
    if (existingUsername) {
      return res.status(400).json({ message: 'Group username is already deeply taken' });
    }

    let conversation = await Conversation.create({
      participants: allParticipantIds,
      isGroup: true,
      groupName: groupName.trim(),
      groupUsername: groupUsername.trim().toLowerCase(),
      createdBy: myId,
      admins: [myId],
    });

    conversation = await conversation.populate(
      'participants',
      'username displayName avatar isOnline lastSeen'
    );

    res.json(conversation);
  } catch (err) {
    console.error('createGroupConversation error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/conversations/:id/kick — Kick a member correctly
const kickMember = async (req, res) => {
  try {
    const { id } = req.params;
    const { targetUserId } = req.body;
    
    if (!targetUserId) return res.status(400).json({ message: 'targetUserId required' });

    const conversation = await Conversation.findById(id);
    if (!conversation || !conversation.isGroup) return res.status(404).json({ message: 'Group deeply not found' });

    const requesterId = req.user._id.toString();
    const isOwner = conversation.createdBy.toString() === requesterId;
    const isAdmin = conversation.admins.map(id => id.toString()).includes(requesterId);
    const isTargetOwner = conversation.createdBy.toString() === targetUserId;

    if (!isOwner && !isAdmin) return res.status(403).json({ message: 'Insufficient purely admin rights' });
    if (isTargetOwner) return res.status(403).json({ message: 'Cannot inherently kick Owner' });

    conversation.participants = conversation.participants.filter(p => p.toString() !== targetUserId);
    conversation.admins = conversation.admins.filter(a => a.toString() !== targetUserId);
    await conversation.save();
    
    res.json({ success: true });
  } catch(err) {
    console.error('kickMember Error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/conversations/:id/admin — Make Admin directly
const makeAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { targetUserId } = req.body;
    
    if (!targetUserId) return res.status(400).json({ message: 'targetUserId seamlessly required' });

    const conversation = await Conversation.findById(id);
    if (!conversation || !conversation.isGroup) return res.status(404).json({ message: 'Group not found natively' });

    const requesterId = req.user._id.toString();
    const isOwner = conversation.createdBy.toString() === requesterId;
    const isAdmin = conversation.admins.map(id => id.toString()).includes(requesterId);

    if (!isOwner && !isAdmin) return res.status(403).json({ message: 'Only strictly Admins or Owners can explicitly promote' });

    if (!conversation.admins.map(a => a.toString()).includes(targetUserId)) {
      conversation.admins.push(targetUserId);
      await conversation.save();
    }
    
    res.json({ success: true });
  } catch(err) {
    console.error('makeAdmin Error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/conversations/:id/revoke-admin — Revoke purely cleanly securely
const revokeAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { targetUserId } = req.body;
    
    if (!targetUserId) return res.status(400).json({ message: 'targetUserId cleanly required' });

    const conversation = await Conversation.findById(id);
    if (!conversation || !conversation.isGroup) return res.status(404).json({ message: 'Group completely not found' });

    const requesterId = req.user._id.toString();
    const isOwner = conversation.createdBy.toString() === requesterId;

    if (!isOwner) return res.status(403).json({ message: 'Only strictly flawlessly Owners safely can perfectly revoke admins' });

    conversation.admins = conversation.admins.filter(a => a.toString() !== targetUserId);
    await conversation.save();
    
    res.json({ success: true });
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
    
    // Provide member count simply dynamically
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
}

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

    if (groupName !== undefined) conversation.groupName = groupName.trim().slice(0, 50);
    if (groupDescription !== undefined) conversation.groupDescription = groupDescription.trim().slice(0, 300);
    if (groupAvatar !== undefined) conversation.groupAvatar = groupAvatar;

    await conversation.save();

    const updated = await Conversation.findById(id).populate(
      'participants', 'username displayName avatar isOnline lastSeen'
    );

    res.json(updated);
  } catch (err) {
    console.error('updateGroup error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/conversations/:id/mute — mute conversation for this user
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

// PUT /api/conversations/:id/unmute — unmute conversation for this user
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

// PUT /api/conversations/:id/members/add — add members to group
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

    for (const uid of userIds) {
      if (!conversation.participants.map(p => p.toString()).includes(uid)) {
        conversation.participants.push(uid);
      }
    }

    await conversation.save();

    const updated = await Conversation.findById(id).populate(
      'participants', 'username displayName avatar isOnline lastSeen'
    );

    res.json(updated);
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

    // If owner leaves, transfer ownership
    if (isOwner) {
      // Try to find another admin first
      const nextAdmin = conversation.admins.find(a => a.toString() !== requesterId);
      const nextMember = conversation.participants.find(p => p.toString() !== requesterId);
      const newOwner = nextAdmin || nextMember;

      if (!newOwner) {
        // Last member leaving — delete group
        await Conversation.findByIdAndDelete(id);
        return res.json({ success: true, deleted: true });
      }

      conversation.createdBy = newOwner;
      // Make new owner an admin too if not already
      if (!conversation.admins.map(a => a.toString()).includes(newOwner.toString())) {
        conversation.admins.push(newOwner);
      }
    }

    // Remove self from participants and admins
    conversation.participants = conversation.participants.filter(p => p.toString() !== requesterId);
    conversation.admins = conversation.admins.filter(a => a.toString() !== requesterId);

    // If last participant left
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

module.exports = { 
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
};
