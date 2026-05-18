const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { decrypt } = require('../utils/encryption');
const { uploadChatImage } = require('../config/cloudinary');

// GET /api/messages/:conversationId?page=1&limit=30
const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const skip = (page - 1) * limit;

    // Verify user is in this conversation (now or in the past)
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });

    const userId = req.user._id.toString();
    const isActive = conversation.participants.some(p => p.toString() === userId);
    const removedEntry = conversation.removedParticipants.find(p => p.userId.toString() === userId);

    if (!isActive && !removedEntry) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const messageQuery = {
      conversationId,
      deletedFor: { $ne: req.user._id },
    };

    // If they were removed, only show messages from BEFORE they were removed
    if (!isActive && removedEntry) {
      messageQuery.createdAt = { $lt: removedEntry.removedAt };
    }

    const messages = await Message.find(messageQuery)
      .populate('senderId', 'username displayName avatar')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Decrypt content and return in chronological order
    const decryptedMessages = messages
      .map((msg) => {
        const obj = msg.toObject();
        try {
          obj.content = decrypt(obj.encryptedContent);
        } catch {
          obj.content = '[message]';
        }
        delete obj.encryptedContent;
        return obj;
      })
      .reverse();

    const total = await Message.countDocuments({
      conversationId,
      deletedFor: { $ne: req.user._id },
    });

    res.json({
      messages: decryptedMessages,
      pagination: {
        page,
        limit,
        total,
        hasMore: total > page * limit,
      },
    });
  } catch (err) {
    console.error('getMessages error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// POST /api/messages/upload — upload image, return Cloudinary URL
const uploadImage = async (req, res) => {
  uploadChatImage(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ message: err.message || 'Upload failed' });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'No file provided' });
    }
    res.json({ imageUrl: req.file.path, publicId: req.file.filename });
  });
};

// DELETE /api/messages/:id?type=self|everyone
const deleteMessage = async (req, res) => {
  try {
    const { type = 'self' } = req.query;
    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ message: 'Message not found' });

    if (type === 'everyone') {
      const conversation = await Conversation.findById(message.conversationId);
      const isSender = message.senderId.toString() === req.user._id.toString();
      const isAdmin = conversation?.isGroup && conversation.admins.some(a => a.toString() === req.user._id.toString());
      const isOwner = conversation?.isGroup && conversation.createdBy.toString() === req.user._id.toString();

      if (!isSender && !isAdmin && !isOwner) {
        return res.status(403).json({ message: 'Unauthorized to delete for everyone' });
      }

      if (message.imageUrl) {
        const { deleteFromCloudinary } = require('../config/cloudinary');
        await deleteFromCloudinary(message.imageUrl);
      }

      await Message.findByIdAndDelete(req.params.id);

      // Broadcast deletion via socket
      const { getIo } = require('../utils/ioInstance');
      const io = getIo();
      if (io) {
        io.to(message.conversationId.toString()).emit('message:deleted', {
          messageId: message._id,
          conversationId: message.conversationId,
        });
      }
    } else {
      // Delete for self only
      message.deletedFor.addToSet(req.user._id);
      await message.save();
    }

    res.json({ success: true });
  } catch (err) {
    console.error('deleteMessage error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// GET /api/messages/search?convId=&q= — search messages in a conversation
const searchMessages = async (req, res) => {
  try {
    const { convId, q } = req.query;

    if (!convId || !q || q.trim().length < 1) {
      return res.json([]);
    }

    // Verify user has access to this conversation
    const conversation = await Conversation.findOne({
      _id: convId,
      participants: req.user._id,
    });
    if (!conversation) return res.status(403).json({ message: 'Access denied' });

    const messages = await Message.find({
      conversationId: convId,
      deletedFor: { $ne: req.user._id },
      content: { $regex: q.trim(), $options: 'i' },
    })
      .populate('senderId', 'username displayName avatar')
      .sort({ createdAt: -1 })
      .limit(50);

    const decrypted = messages.map((msg) => {
      const obj = msg.toObject();
      try {
        obj.content = decrypt(obj.encryptedContent);
      } catch {
        obj.content = '[message]';
      }
      delete obj.encryptedContent;
      return obj;
    });

    res.json(decrypted);
  } catch (err) {
    console.error('searchMessages error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// GET /api/messages/:id/info — get who read the message and when
const getMessageInfo = async (req, res) => {
  try {
    const message = await Message.findById(req.params.id)
      .populate('seenBy.userId', 'username displayName avatar')
      .populate('reactions.userId', 'username displayName avatar')
      .select('seenBy reactions senderId');

    if (!message) return res.status(404).json({ message: 'Message not found' });

    // Filter out any invalid entries (e.g. from before schema change) 
    // and ensure userId is populated
    const validSeenBy = message.seenBy.filter(s => s && s.userId);
    
    res.json({
      seenBy: validSeenBy,
      reactions: message.reactions || []
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { getMessages, uploadImage, deleteMessage, searchMessages, getMessageInfo };

