const express = require('express');

const router = express.Router();

const {
    login
} = require('../controllers/authController');

// Customer login
router.post('/login', login);

module.exports = router;