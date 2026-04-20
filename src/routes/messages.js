const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { getMessages, uploadImage, deleteMessage, searchMessages } = require('../controllers/messageController');

router.use(authenticate);

router.get('/search', searchMessages);
router.get('/:conversationId', getMessages);
router.post('/upload', uploadImage);
router.delete('/:id', deleteMessage);

module.exports = router;
