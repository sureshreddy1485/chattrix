const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { encrypt, decrypt } = require('../utils/encryption');
const { sendPushNotification } = require('../utils/pushNotifications');

const socketHandler = (io) => {
  // ─── Socket Auth Middleware ───────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication error: no token'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-passwordHash -socketId');
      if (!user) return next(new Error('Authentication error: user not found'));

      socket.userId = user._id.toString();
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Authentication error: invalid token'));
    }
  });

  // ─── Connection ───────────────────────────────────────────────────────────
  io.on('connection', async (socket) => {
    const userId = socket.userId;
    console.log(`🔌 Connected: ${socket.user.username} (${userId})`);

    // Mark user online, save socketId
    await User.findByIdAndUpdate(userId, {
      isOnline: true,
      socketId: socket.id,
      lastSeen: new Date(),
    });

    // Join personal room (for direct delivery)
    socket.join(userId);

    // Notify all contacts of online status
    await notifyContacts(io, userId, { isOnline: true, lastSeen: new Date() });

    // ── Deliver Pending (Offline) Messages ───────────────────────────────
    // Find all conversations this user is part of
    const conversations = await Conversation.find({ participants: userId }).select('_id');
    const convIds = conversations.map((c) => c._id);

    // Find all messages sent to these conversations that are still 'sent' (not delivered)
    const pendingMessages = await Message.find({
      conversationId: { $in: convIds },
      senderId: { $ne: userId },
      status: 'sent',
    })
      .populate('senderId', 'username displayName avatar')
      .sort({ createdAt: 1 });

    for (const msg of pendingMessages) {
      const decryptedContent = safeDecrypt(msg.encryptedContent);
      socket.emit('message:received', {
        ...msg.toObject(),
        content: decryptedContent,
      });
      // Mark as delivered
      await Message.findByIdAndUpdate(msg._id, { status: 'delivered' });
      // Notify sender of delivery
      io.to(msg.senderId._id.toString()).emit('message:delivered', {
        messageId: msg._id,
        conversationId: msg.conversationId,
      });
    }

    if (pendingMessages.length > 0) {
      console.log(`📬 Delivered ${pendingMessages.length} pending messages to ${socket.user.username}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // EVENT: message:send
    // ─────────────────────────────────────────────────────────────────────
    socket.on('message:send', async (data, ack) => {
      try {
        const { conversationId, content, type = 'text', imageUrl } = data;

        if (!conversationId || (!content && !imageUrl)) {
          if (ack) ack({ error: 'Invalid message data' });
          return;
        }

        // Verify sender is in this conversation
        const conversation = await Conversation.findOne({
          _id: conversationId,
          participants: userId,
        });

        if (!conversation) {
          if (ack) ack({ error: 'Conversation not found' });
          return;
        }
        // ── Block Check (1-on-1 only) ─────────────────────────────────────
        if (!conversation.isGroup) {
          const myId = userId.toString();
          const otherParticipant = conversation.participants.find(p => p.toString() !== myId);
          if (otherParticipant) {
            const otherUser = await User.findById(otherParticipant).select('blockedUsers');
            if (otherUser && otherUser.blockedUsers.includes(myId)) {
              if (ack) ack({ success: false, error: 'Blocked' });
              return;
            }
            // Also check if I blocked them
            const me = await User.findById(userId).select('blockedUsers');
            if (me && me.blockedUsers.includes(otherParticipant.toString())) {
              if (ack) ack({ success: false, error: 'You have blocked this user' });
              return;
            }
          }
        }

        // Encrypt content
        const encryptedContent = encrypt(content || '');

        // Save message to DB
        const message = await Message.create({
          conversationId,
          senderId: userId,
          content: content || '',
          encryptedContent,
          type,
          imageUrl: imageUrl || null,
          status: 'sent',
        });

        // Update conversation's last message
        await Conversation.findByIdAndUpdate(conversationId, {
          lastMessage: message._id,
          updatedAt: new Date(),
        });

        // Populate sender for response
        const populatedMsg = await Message.findById(message._id).populate(
          'senderId',
          'username displayName avatar'
        );

        const msgPayload = {
          ...populatedMsg.toObject(),
          content: content || '',
        };

        // Confirm to sender immediately
        socket.emit('message:sent', {
          messageId: message._id,
          conversationId,
          status: 'sent',
          timestamp: message.createdAt,
          tempId: data.tempId, // echo back client temp ID for optimistic updates
        });

        if (ack) ack({ success: true, messageId: message._id });

        // ── Deliver to recipients ─────────────────────────────────────────
        const recipientIds = conversation.participants.filter(
          (p) => p.toString() !== userId
        );

        for (const recipientId of recipientIds) {
          const recipientIdStr = recipientId.toString();
          const recipient = await User.findById(recipientId).select('isOnline pushToken username');

          // Increment unread count
          const currentCount = conversation.unreadCount.get(recipientIdStr) || 0;
          conversation.unreadCount.set(recipientIdStr, currentCount + 1);

          if (recipient.isOnline) {
            // User is online — deliver immediately
            io.to(recipientIdStr).emit('message:received', msgPayload);

            // Update status to delivered
            await Message.findByIdAndUpdate(message._id, { status: 'delivered' });

            // Notify sender of delivery
            socket.emit('message:delivered', {
              messageId: message._id,
              conversationId,
            });
          } else {
            // User is offline — send push only if not muted
            const isMuted = conversation.mutedBy?.some(
              (uid) => uid.toString() === recipientIdStr
            );

            if (recipient.pushToken && !isMuted) {
              const notifBody =
                type === 'image' ? '📷 Photo' : type === 'emoji' ? content : content;
              await sendPushNotification(recipient.pushToken, {
                title: socket.user.displayName || socket.user.username,
                body: notifBody,
                data: {
                  type: 'new_message',
                  conversationId: conversationId.toString(),
                  messageId: message._id.toString(),
                  senderId: userId,
                },
              });
            }
          }
        }

        await conversation.save(); // save unread counts
      } catch (err) {
        console.error('message:send error:', err);
        if (ack) ack({ error: 'Failed to send message' });
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // ─────────────────────────────────────────────────────────────────────
    // EVENT: message:seen
    // ─────────────────────────────────────────────────────────────────────
    socket.on('message:seen', async ({ messageId, conversationId }) => {
      try {
        const message = await Message.findOneAndUpdate(
          { _id: messageId, status: { $ne: 'seen' } },
          { status: 'seen', $addToSet: { seenBy: userId } },
          { new: true }
        );

        if (message) {
          // Notify sender
          io.to(message.senderId.toString()).emit('message:seen', {
            messageId,
            conversationId,
            seenBy: userId,
          });

          // Reset unread count for this user
          const conv = await Conversation.findById(conversationId);
          if (conv) {
            conv.unreadCount.set(userId, 0);
            await conv.save();
          }
        }
      } catch (err) {
        console.error('message:seen error:', err);
      }
    });

    // ─────────────────────────────────────────────────────────────────────
    // EVENT: message:reaction
    // ─────────────────────────────────────────────────────────────────────
    socket.on('message:reaction', async ({ messageId, conversationId, emoji }) => {
      try {
        const message = await Message.findById(messageId);
        if (!message) return;

        const existingIdx = message.reactions.findIndex(
          (r) => r.userId.toString() === userId
        );

        if (existingIdx > -1) {
          if (message.reactions[existingIdx].emoji === emoji) {
            // Remove reaction (toggle off)
            message.reactions.splice(existingIdx, 1);
          } else {
            // Change reaction
            message.reactions[existingIdx].emoji = emoji;
          }
        } else {
          message.reactions.push({ userId, emoji });
        }

        await message.save();

        // Broadcast to all in conversation
        io.to(conversationId).emit('message:reaction:updated', {
          messageId,
          reactions: message.reactions,
        });
      } catch (err) {
        console.error('message:reaction error:', err);
      }
    });

    // ─────────────────────────────────────────────────────────────────────
    // TYPING INDICATORS
    // ─────────────────────────────────────────────────────────────────────
    socket.on('typing:start', ({ conversationId }) => {
      socket.to(conversationId).emit('typing:indicator', {
        userId,
        username: socket.user.username,
        displayName: socket.user.displayName || socket.user.username,
        conversationId,
        isTyping: true,
      });
    });

    socket.on('typing:stop', ({ conversationId }) => {
      socket.to(conversationId).emit('typing:indicator', {
        userId,
        conversationId,
        isTyping: false,
      });
    });

    // ─────────────────────────────────────────────────────────────────────
    // CONVERSATION ROOMS
    // ─────────────────────────────────────────────────────────────────────
    socket.on('conversation:join', ({ conversationId }) => {
      socket.join(conversationId);
    });

    socket.on('conversation:leave', ({ conversationId }) => {
      socket.leave(conversationId);
    });

    // ─────────────────────────────────────────────────────────────────────
    // DISCONNECT
    // ─────────────────────────────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      console.log(`🔌 Disconnected: ${socket.user.username} — reason: ${reason}`);

      const now = new Date();
      await User.findByIdAndUpdate(userId, {
        isOnline: false,
        socketId: null,
        lastSeen: now,
      });

      await notifyContacts(io, userId, { isOnline: false, lastSeen: now });
    });
  });
};

// ─── Helper Functions ─────────────────────────────────────────────────────────

async function notifyContacts(io, userId, statusPayload) {
  const user = await User.findById(userId).select('contacts').lean();
  if (!user?.contacts?.length) return;

  user.contacts.forEach((contactId) => {
    io.to(contactId.toString()).emit('user:status', {
      userId,
      ...statusPayload,
    });
  });
}

function safeDecrypt(encryptedContent) {
  try {
    const { decrypt } = require('../utils/encryption');
    return decrypt(encryptedContent);
  } catch {
    return '[message]';
  }
}

/**
 * Broadcast a system message to all participants currently in a conversation room.
 * Call this from REST controllers after creating a system message.
 */
async function broadcastSystemMessage(io, conversationId, systemMsg) {
  try {
    const populated = await Message.findById(systemMsg._id).populate(
      'senderId', 'username displayName avatar'
    );
    if (!populated) return;
    const payload = { ...populated.toObject(), content: 'System Event' };
    io.to(conversationId.toString()).emit('message:received', payload);
  } catch (err) {
    console.error('broadcastSystemMessage error:', err);
  }
}

module.exports = socketHandler;
module.exports.broadcastSystemMessage = broadcastSystemMessage;
