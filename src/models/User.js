const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, 'Username is required'],
      unique: true,
      trim: true,
      lowercase: true,
      minlength: [3, 'Username must be at least 3 characters'],
      maxlength: [20, 'Username must be at most 20 characters'],
      match: [/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    displayName: {
      type: String,
      trim: true,
      maxlength: [50, 'Display name too long'],
      default: '',
    },
    bio: {
      type: String,
      maxlength: [200, 'Bio too long'],
      default: '',
    },
    avatar: {
      type: String,
      default: null,
    },
    contacts: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    blockedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    isOnline: {
      type: Boolean,
      default: false,
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    pushToken: {
      type: String,
      default: null,
    },
    socketId: {
      type: String,
      default: null,
      select: false,
    },
    resetPasswordOTP: {
      type: String,
      default: null,
      select: false,
    },
    resetPasswordExpires: {
      type: Date,
      default: null,
      select: false,
    },
    // Per-group DM privacy: array of { groupId, allowDm }
    groupDmSettings: [
      {
        groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation' },
        allowDm: { type: Boolean, default: true },
      },
    ],
    coverPhoto: {
      type: String,
      default: null,
    },
    interests: [
      {
        type: String,
      },
    ],
    statusEmoji: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

// Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
  next();
});

// Compare password
userSchema.methods.comparePassword = async function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

// Remove sensitive fields from toJSON
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  delete obj.socketId;
  delete obj.blockedUsers;
  return obj;
};

// Index for search performance
userSchema.index({ username: 'text', displayName: 'text' });

module.exports = mongoose.model('User', userSchema);
