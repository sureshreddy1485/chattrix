const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');

dotenv.config({ path: path.join(__dirname, '../../.env') });

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('Connected to DB natively.');
    
    const count = await Message.countDocuments();
    console.log(`Total messages natively: ${count}`);

    const latestMessages = await Message.find()
      .populate('senderId', 'username email')
      .sort({ createdAt: -1 })
      .limit(5);
    
    console.log('Latest messages:', JSON.stringify(latestMessages, null, 2));

    const conversations = await Conversation.find()
      .sort({ updatedAt: -1 })
      .limit(5);
      
    console.log('Conversations:', JSON.stringify(conversations, null, 2));

    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
