const express = require('express');

const router = express.Router();

const authMiddleware = require('../middleware/authMiddleware');

const {
    getMyVouchers,
    getVoucherDetails,
    reviewVoucherTransfer
} = require('../controllers/ewalletTransferController');

// All routes require an authenticated customer.
router.use(authMiddleware);

// Retrieve all customer vouchers.
router.get('/vouchers', getMyVouchers);

// Retrieve one voucher.
router.get('/vouchers/:voucherCode', getVoucherDetails);

// Review an eWallet-to-MoMo transfer.
router.post('/transfer/review', reviewVoucherTransfer);

module.exports = router;