const pool = require('../config/db');
const bcrypt = require('bcrypt');

// Validate a positive monetary amount with no more than 2 decimal places.
function isValidAmount(value) {
    if (value === undefined || value === null || value === '') {
        return false;
    }

    const amount = String(value);

    return /^\d+(\.\d{1,2})?$/.test(amount) &&
        Number(amount) > 0 &&
        Number.isFinite(Number(amount));
}

// GET /api/ewallet/vouchers
// Return vouchers belonging to the logged-in customer.
const getMyVouchers = async (req, res) => {
    try {
        const accountNumber = req.account.account_number;

        const [vouchers] = await pool.execute(
            `SELECT
                voucher_id,
                voucher_code,
                recipient_cellphone,
                amount,
                remaining_balance,
                transferred_amount,
                reserved_balance,
                currency,
                status
             FROM ewallet_voucher
             WHERE sender_account_number = ?
             ORDER BY voucher_id DESC`,
            [accountNumber]
        );

        return res.status(200).json({
            success: true,
            message: 'Vouchers retrieved successfully',
            count: vouchers.length,
            vouchers
        });

    } catch (error) {
        console.error('Get vouchers error:', error);

        return res.status(500).json({
            success: false,
            message: 'Unable to retrieve vouchers'
        });
    }
};


// GET /api/ewallet/vouchers/:voucherCode
// Retrieve one voucher belonging to the logged-in customer.
const getVoucherDetails = async (req, res) => {
    try {
        const accountNumber = req.account.account_number;
        const { voucherCode } = req.params;

        const [vouchers] = await pool.execute(
            `SELECT
                voucher_id,
                voucher_code,
                recipient_cellphone,
                amount,
                remaining_balance,
                transferred_amount,
                reserved_balance,
                currency,
                status
             FROM ewallet_voucher
             WHERE voucher_code = ?
               AND sender_account_number = ?
             LIMIT 1`,
            [voucherCode, accountNumber]
        );

        if (vouchers.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Voucher not found'
            });
        }

        return res.status(200).json({
            success: true,
            voucher: vouchers[0]
        });

    } catch (error) {
        console.error('Voucher details error:', error);

        return res.status(500).json({
            success: false,
            message: 'Unable to retrieve voucher details'
        });
    }
};


// POST /api/ewallet/transfer/review
// Validate a voucher before the customer confirms a MoMo transfer.
const reviewVoucherTransfer = async (req, res) => {
    try {
        const accountNumber = req.account.account_number;

        const {
            voucher_code,
            pin,
            recipient_phone,
            amount
        } = req.body;

        // Validate required fields.
        if (!voucher_code || !pin || !recipient_phone || amount === undefined) {
            return res.status(400).json({
                success: false,
                message: 'Voucher code, PIN, recipient phone and amount are required'
            });
        }

        // Validate the five-digit voucher PIN.
        if (!/^\d{5}$/.test(String(pin))) {
            return res.status(400).json({
                success: false,
                message: 'Voucher PIN must contain exactly five digits'
            });
        }

        // Validate the Eswatini mobile number.
        if (!/^268\d{8}$/.test(String(recipient_phone))) {
            return res.status(400).json({
                success: false,
                message: 'Enter a valid Eswatini mobile number starting with 268'
            });
        }

        if (!isValidAmount(amount)) {
            return res.status(400).json({
                success: false,
                message: 'Enter a valid amount greater than zero with at most two decimal places'
            });
        }

        // Retrieve the voucher belonging to this customer.
        const [vouchers] = await pool.execute(
            `SELECT
                voucher_code,
                sender_account_number,
                amount,
                remaining_balance,
                transferred_amount,
                reserved_balance,
                currency,
                pin_hash,
                status
             FROM ewallet_voucher
             WHERE voucher_code = ?
               AND sender_account_number = ?
             LIMIT 1`,
            [voucher_code, accountNumber]
        );

        if (vouchers.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Voucher not found or does not belong to your account'
            });
        }

        const voucher = vouchers[0];

        // Check voucher status.
        if (!['ACTIVE', 'PARTIALLY_USED'].includes(voucher.status)) {
            return res.status(400).json({
                success: false,
                message: `This voucher cannot be used. Current status: ${voucher.status}`
            });
        }

        // Verify the five-digit voucher PIN.
        const pinIsValid = await bcrypt.compare(
            String(pin),
            voucher.pin_hash
        );

        if (!pinIsValid) {
            return res.status(401).json({
                success: false,
                message: 'Incorrect voucher PIN'
            });
        }

        // Check available balance, excluding funds already reserved.
        const availableBalance =
            Number(voucher.remaining_balance) -
            Number(voucher.reserved_balance);

        const requestedAmount = Number(amount);

        if (requestedAmount > availableBalance + 0.000001) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient voucher balance',
                available_balance: availableBalance
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Transfer details validated successfully',

            transfer: {
                voucher_code: voucher.voucher_code,
                sender_account: String(voucher.sender_account_number),
                recipient_phone,
                amount: requestedAmount,
                currency: voucher.currency,
                available_balance: availableBalance,
                balance_after_success: Number(
                    (availableBalance - requestedAmount).toFixed(2)
                ),
                destination_institution: 'MTN',
                payment_type: 'EWALLET_TO_MOMO'
            }
        });

    } catch (error) {
        console.error('Voucher transfer review error:', error);

        return res.status(500).json({
            success: false,
            message: 'Unable to review transfer'
        });
    }
};


module.exports = {
    getMyVouchers,
    getVoucherDetails,
    reviewVoucherTransfer
};