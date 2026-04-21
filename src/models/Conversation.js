const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
    ],
    lastMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
    isGroup: {
      type: Boolean,
      default: false,
    },
    groupName: {
      type: String,
      default: null,
      trim: true,
      maxlength: 50,
    },
    groupUsername: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 30,
    },
    groupAvatar: {
      type: String,
      default: null,
    },
    groupDescription: {
      type: String,
      default: '',
      maxlength: 300,
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    admins: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    // unreadCount: { userId: count }
    unreadCount: {
      type: Map,
      of: Number,
      default: {},
    },
    // Muted: set of userIds who muted this conversation
    mutedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    // Pinned: set of userIds who pinned this conversation
    pinnedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  { timestamps: true }
);

// Unique 1-on-1 conversation (sorted participant IDs)
conversationSchema.index({ participants: 1 });

// Unique group username index (sparse ensures it ignores null values natively)
conversationSchema.index({ groupUsername: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Conversation', conversationSchema);
