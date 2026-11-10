const express = require('express');
const router = express.Router();

const {
    checkRecipient,
    reviewEwallet,
    sendEwallet
} = require('../controllers/ewalletController');

const {
    lookupCustomer,
    lookupRecipient,
    lookupVoucher,
    registerCustomer,
    reviewTransfer,
    authorizeTransfer,
    sendMoney
} = require('../controllers/ussdController');

const authMiddleware = require('../middleware/authMiddleware');

// Existing Android eWallet endpoints
router.post('/recipient/check', authMiddleware, checkRecipient);
router.post('/review', authMiddleware, reviewEwallet);
router.post('/send', authMiddleware, sendEwallet);

// React USSD simulator endpoints (public: no token, the customer
// is identified by phone number and transaction PIN)
router.get('/ussd/customer/:phone', lookupCustomer);
router.get('/ussd/recipient/:phone', lookupRecipient);
router.get('/ussd/voucher/:phone', lookupVoucher);
router.post('/ussd/register', registerCustomer);
router.post('/ussd/review', reviewTransfer);
router.post('/ussd/authorize', authorizeTransfer);
router.post('/ussd/send', sendMoney);

module.exports = router;