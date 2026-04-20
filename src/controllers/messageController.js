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

    // Verify user is in this conversation
    const conversation = await Conversation.findOne({
      _id: conversationId,
      participants: req.user._id,
    });
    if (!conversation) return res.status(403).json({ message: 'Access denied' });

    const messages = await Message.find({
      conversationId,
      deletedFor: { $ne: req.user._id },
    })
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

// DELETE /api/messages/:id — delete message for self
const deleteMessage = async (req, res) => {
  try {
    const message = await Message.findById(req.params.id);
    if (!message) return res.status(404).json({ message: 'Message not found' });

    message.deletedFor.addToSet(req.user._id);
    await message.save();

    res.json({ success: true });
  } catch (err) {
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

module.exports = { getMessages, uploadImage, deleteMessage, searchMessages };

