const User = require('../models/User');
const { uploadAvatar } = require('../config/cloudinary');

// GET /api/users/search?q=username
const searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ message: 'Search query too short' });
    }

    const users = await User.find({
      username: { $regex: q.trim(), $options: 'i' },
      _id: { $ne: req.user._id },
    })
      .select('username displayName avatar isOnline lastSeen')
      .limit(20);

    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

// GET /api/users/:id
const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select(
      'username displayName avatar bio isOnline lastSeen'
    );
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/users/profile
const updateProfile = async (req, res) => {
  try {
    const { displayName, bio } = req.body;
    const updates = {};

    if (displayName !== undefined) updates.displayName = displayName.trim().slice(0, 50);
    if (bio !== undefined) updates.bio = bio.trim().slice(0, 200);

    // If avatar uploaded via multer-cloudinary
    if (req.file?.path) {
      updates.avatar = req.file.path;
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

// GET /api/users/contacts
const getContacts = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('contacts', 'username displayName avatar isOnline lastSeen bio')
      .select('contacts');
    res.json(user.contacts);
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

// POST /api/users/contacts/add
const addContact = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ message: 'userId required' });
    if (userId === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot add yourself' });
    }

    const target = await User.findById(userId);
    if (!target) return res.status(404).json({ message: 'User not found' });

    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: { contacts: userId },
    });

    res.json({ success: true, user: target });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

// DELETE /api/users/contacts/:id
const removeContact = async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { contacts: req.params.id },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/users/push-token — save Expo push token
const savePushToken = async (req, res) => {
  try {
    const { pushToken } = req.body;
    if (!pushToken) return res.status(400).json({ message: 'pushToken required' });

    await User.findByIdAndUpdate(req.user._id, { pushToken });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  searchUsers,
  getUserById,
  updateProfile,
  getContacts,
  addContact,
  removeContact,
  savePushToken,
};

