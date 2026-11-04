const express = require('express');
const router = express.Router();

const protect = require('../middleware/authMiddleware');
const { getMyAccount } = require('../controllers/accountController');

// Retrieve logged-in customer's account
router.get('/', protect, getMyAccount);

module.exports = router;