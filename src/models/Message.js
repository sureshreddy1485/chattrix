const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Conversation',
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Plain content stored encrypted; decrypted on delivery
    content: {
      type: String,
      default: '',
    },
    encryptedContent: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['text', 'image', 'emoji', 'system'],
      default: 'text',
    },
    // Only present when type === 'system'
    systemEvent: {
      action: { type: String, default: null },   // 'joined','added','promoted','demoted','removed','created'
      actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      targetId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      actorName: { type: String, default: null },
      targetName: { type: String, default: null },
    },
    imageUrl: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['sent', 'delivered', 'seen'],
      default: 'sent',
      index: true,
    },
    seenBy: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        seenAt: { type: Date, default: Date.now },
      },
    ],
    reactions: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        emoji: { type: String },
      },
    ],
    isDisappearing: {
      type: Boolean,
      default: false,
    },
    disappearingMode: {
      type: String,
      enum: ['off', 'seen', '24h_seen', '7d_seen'],
      default: 'off',
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    isLive: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// TTL index for disappearing messages
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

// Compound index for efficient conversation message fetching
messageSchema.index({ conversationId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
