
const express = require('express');
const router = express.Router();

const {
    reviewEwallet,
    sendEwallet
} = require('../controllers/ewalletController');

const authMiddleware = require('../middleware/authMiddleware');

router.post('/review', authMiddleware, reviewEwallet);
router.post('/send', authMiddleware, sendEwallet);

module.exports = router;
