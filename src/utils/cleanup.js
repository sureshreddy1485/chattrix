const Message = require('../models/Message');
const { deleteFromCloudinary } = require('../config/cloudinary');

/**
 * Cleanup task to find expired messages and delete their associated media from Cloudinary
 * before they are removed from MongoDB by the TTL index.
 */
const cleanupExpiredMessages = async () => {
  try {
    const now = new Date();
    
    // Find messages that have expired and have an image, but are still in DB
    const expiredMessages = await Message.find({
      expiresAt: { $lte: now },
      imageUrl: { $ne: null }
    });

    if (expiredMessages.length > 0) {
      console.log(`🧹 Cleaning up ${expiredMessages.length} expired messages with media...`);
      
      for (const msg of expiredMessages) {
        try {
          if (msg.imageUrl) {
            console.log(`🗑️ Deleting Cloudinary image for message ${msg._id}`);
            await deleteFromCloudinary(msg.imageUrl);
          }
          // We can let TTL index handle the DB deletion, 
          // or delete it now to be sure it's fully cleaned up.
          await Message.deleteOne({ _id: msg._id });
        } catch (err) {
          console.error(`❌ Error cleaning up message ${msg._id}:`, err);
        }
      }
    }
  } catch (err) {
    console.error('❌ Cleanup Task Error:', err);
  }
};

module.exports = { cleanupExpiredMessages };
