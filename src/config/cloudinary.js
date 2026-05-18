const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Storage for chat images
const chatImageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'nexchat/messages',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    transformation: [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto' }],
  },
});

// Storage for profile avatars
const avatarStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'nexchat/avatars',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face', quality: 'auto' }],
  },
});

const uploadChatImage = multer({
  storage: chatImageStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
}).single('image');

const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
}).single('avatar');

const deleteFromCloudinary = async (identifier) => {
  try {
    if (!identifier) return;
    let publicId = identifier;
    if (identifier.startsWith('http')) {
      // Extract public ID from URL: nexchat/avatars/abc123...
      const parts = identifier.split('/');
      const folderIdx = parts.findIndex(p => p === 'nexchat');
      if (folderIdx > -1) {
        // e.g. nexchat/avatars/filename.jpg -> nexchat/avatars/filename
        const relevantParts = parts.slice(folderIdx);
        const lastPart = relevantParts[relevantParts.length - 1].split('.')[0];
        relevantParts[relevantParts.length - 1] = lastPart;
        publicId = relevantParts.join('/');
      }
    }
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.error('Cloudinary Delete Error:', err);
  }
};

module.exports = { cloudinary, uploadChatImage, uploadAvatar, deleteFromCloudinary };
