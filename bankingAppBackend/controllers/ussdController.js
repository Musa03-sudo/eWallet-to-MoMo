const pool = require('../config/db');
const bcrypt = require('bcrypt');
const { processTransfer } = require('../services/cbe/cbeSwitch');

// --------------------------------------------------
// PHONE NUMBER VALIDATION
// Accepts 8-digit local or 268 + 8-digit numbers
// Always returns the international format: 268XXXXXXXX
// --------------------------------------------------
function normalizePhone(value) {
    if (!value) return null;

    let phone = String(value).replace(/\s+/g, '').replace(/^\+/, '');

    if (/^\d{8}$/.test(phone)) {
        phone = `268${phone}`;
    }

    if (!/^268\d{8}$/.test(phone)) {
        return null;
    }

    return phone;
}

// --------------------------------------------------
// AMOUNT VALIDATION
// --------------------------------------------------
function validAmount(value) {
    const amount = Number(value);

    return (
        value !== undefined &&
        value !== null &&
        /^\d+(\.\d{1,2})?$/.test(String(value)) &&
        Number.isFinite(amount) &&
        amount > 0
    );
}

// --------------------------------------------------
// FIND REGISTERED EWALLET CUSTOMER
// ewallet_customers stores full numbers: 268XXXXXXXX
// --------------------------------------------------
async function findCustomer(phone) {
    const [rows] = await pool.execute(
        `SELECT
            phone_number,
            name,
            surname,
            wallet_balance,
            currency,
            status,
            account_type,
            transaction_password_hash
         FROM ewallet_customers
         WHERE phone_number = ?
         LIMIT 1`,
        [phone]
    );

    return rows[0] || null;
}

// --------------------------------------------------
// FIND MTN MOMO RECIPIENT
// momo_active_users stores full numbers: 268XXXXXXXX
// (the phone passed in is already normalized)
// --------------------------------------------------
async function findRecipient(phone) {
    const [rows] = await pool.execute(
        `SELECT
            phone_number,
            fullname,
            balance,
            activity
         FROM momo_active_users
         WHERE phone_number = ?
         LIMIT 1`,
        [phone]
    );

    return rows[0] || null;
}

// --------------------------------------------------
// LOOK UP REGISTERED EWALLET CUSTOMER
// GET /api/ewallet/ussd/customer/:phone
// --------------------------------------------------
const lookupCustomer = async (req, res) => {
    try {
        const phone = normalizePhone(req.params.phone);

        if (!phone) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_PHONE',
                message: 'Please enter a valid cellphone number.'
            });
        }

        const customer = await findCustomer(phone);

        if (!customer || customer.status !== 'ACTIVE') {
            return res.status(404).json({
                success: false,
                code: 'NOT_REGISTERED',
                message: 'This number is not registered for eWallet services.'
            });
        }

        return res.status(200).json({
            success: true,
            customer: {
                phone_number: customer.phone_number,
                name: customer.name,
                surname: customer.surname,
                wallet_balance: Number(customer.wallet_balance),
                currency: customer.currency,
                status: customer.status,
                account_type: customer.account_type
            }
        });

    } catch (error) {
        console.error('Customer lookup error:', error);

        return res.status(500).json({
            success: false,
            code: 'SERVER_ERROR',
            message: 'Unable to look up customer.'
        });
    }
};

// --------------------------------------------------
// LOOK UP MTN MOMO RECIPIENT
// GET /api/ewallet/ussd/recipient/:phone
// --------------------------------------------------
const lookupRecipient = async (req, res) => {
    try {
        const phone = normalizePhone(req.params.phone);

        if (!phone) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_PHONE',
                message: 'Please enter a valid recipient cellphone number.'
            });
        }

        const recipient = await findRecipient(phone);

        if (!recipient) {
            return res.status(404).json({
                success: false,
                code: 'RECIPIENT_NOT_FOUND',
                message: 'The recipient is not registered with MTN MoMo.'
            });
        }

        if (recipient.activity !== 'ACTIVE') {
            return res.status(403).json({
                success: false,
                code: 'RECIPIENT_INACTIVE',
                message: 'The recipient MoMo account is not active.'
            });
        }

        return res.status(200).json({
            success: true,
            recipient: {
                // Already stored in full format (268XXXXXXXX)
                phone_number: recipient.phone_number,
                fullname: recipient.fullname,
                activity: recipient.activity
            }
        });

    } catch (error) {
        console.error('Recipient lookup error:', error);

        return res.status(500).json({
            success: false,
            code: 'SERVER_ERROR',
            message: 'Unable to look up recipient.'
        });
    }
};

// --------------------------------------------------
// LOOK UP VOUCHERS FOR AN UNREGISTERED CUSTOMER
// GET /api/ewallet/ussd/voucher/:phone
//
// Reads the unregistered_ewallet_customers VIEW.
// Does not create a customer or change voucher records.
// --------------------------------------------------
const lookupVoucher = async (req, res) => {
    try {
        const phone = normalizePhone(req.params.phone);

        if (!phone) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_PHONE',
                message: 'Please enter a valid cellphone number.'
            });
        }

        // A registered customer should use their existing wallet.
        const customer = await findCustomer(phone);

        if (customer) {
            return res.status(409).json({
                success: false,
                code: 'ALREADY_REGISTERED',
                message: 'This number is already registered for eWallet services.'
            });
        }

        // Read the aggregated voucher details from the VIEW.
        const [rows] = await pool.execute(
            `SELECT
                phone_number,
                total_vouchers,
                total_voucher_amount,
                total_available_balance,
                currency
             FROM unregistered_ewallet_customers
             WHERE phone_number = ?
             LIMIT 1`,
            [phone]
        );

        if (
            rows.length === 0 ||
            Number(rows[0].total_available_balance) <= 0
        ) {
            return res.status(404).json({
                success: false,
                code: 'NO_VOUCHERS',
                message: 'No available eWallet vouchers were found for this number.'
            });
        }

        const voucher = rows[0];

        return res.status(200).json({
            success: true,
            code: 'VOUCHERS_FOUND',
            message: 'Available vouchers found. You can register for eWallet.',
            voucher: {
                phone_number: voucher.phone_number,
                total_vouchers: Number(voucher.total_vouchers),
                total_voucher_amount: Number(voucher.total_voucher_amount),
                total_available_balance: Number(voucher.total_available_balance),
                currency: voucher.currency
            }
        });

    } catch (error) {
        console.error('Voucher lookup error:', error);

        return res.status(500).json({
            success: false,
            code: 'SERVER_ERROR',
            message: 'Unable to check vouchers at this time.'
        });
    }
};

// --------------------------------------------------
// REGISTER EWALLET CUSTOMER (BETA ACCOUNT)
// POST /api/ewallet/ussd/register
//
// Body: { phone_number, national_id, pin, confirm_pin }
//
// Creates a BETA account (upgraded after KYC), stores the
// bcrypt-hashed PIN and credits the voucher balance.
// Everything happens in one DB transaction.
// --------------------------------------------------
const registerCustomer = async (req, res) => {
    let connection;

    try {
        const phone = normalizePhone(req.body.phone_number);
        const nationalId = String(req.body.national_id || '').trim();
        const pin = String(req.body.pin || '');
        const confirmPin = String(req.body.confirm_pin || '');

        if (!phone) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_PHONE',
                message: 'Please provide a valid cellphone number.'
            });
        }

        if (nationalId.length < 5 || nationalId.length > 30) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_NATIONAL_ID',
                message: 'Please provide a valid National ID number.'
            });
        }

        if (!/^\d{5}$/.test(pin)) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_PIN',
                message: 'Your transaction PIN must contain exactly five digits.'
            });
        }

        if (pin !== confirmPin) {
            return res.status(400).json({
                success: false,
                code: 'PIN_MISMATCH',
                message: 'The PINs do not match.'
            });
        }

        const pinHash = await bcrypt.hash(pin, 10);

        connection = await pool.getConnection();
        await connection.beginTransaction();

        // Already registered by phone or National ID?
        const [existing] = await connection.execute(
            `SELECT phone_number, national_id
             FROM ewallet_customers
             WHERE phone_number = ? OR national_id = ?
             LIMIT 1
             FOR UPDATE`,
            [phone, nationalId]
        );

        if (existing.length > 0) {
            await connection.rollback();

            const samePhone = existing[0].phone_number === phone;

            return res.status(409).json({
                success: false,
                code: samePhone ? 'ALREADY_REGISTERED' : 'NATIONAL_ID_IN_USE',
                message: samePhone
                    ? 'This number is already registered for eWallet services.'
                    : 'This National ID is already linked to an eWallet account.'
            });
        }

        // Voucher balance to credit (read from the VIEW).
        const [voucherRows] = await connection.execute(
            `SELECT
                total_available_balance,
                currency
             FROM unregistered_ewallet_customers
             WHERE phone_number = ?
             LIMIT 1`,
            [phone]
        );

        if (
            voucherRows.length === 0 ||
            Number(voucherRows[0].total_available_balance) <= 0
        ) {
            await connection.rollback();

            return res.status(404).json({
                success: false,
                code: 'NO_VOUCHERS',
                message: 'No available eWallet vouchers were found for this number.'
            });
        }

        const openingBalance = Number(voucherRows[0].total_available_balance);
        const currency = voucherRows[0].currency || 'SZL';

        // BETA until KYC is completed. Name and surname are
        // not collected yet, so they are stored as NULL.
        await connection.execute(
            `INSERT INTO ewallet_customers (
                phone_number,
                name,
                surname,
                national_id,
                transaction_password_hash,
                password_created_at,
                status,
                wallet_balance,
                currency,
                account_type
             ) VALUES (?, NULL, NULL, ?, ?, NOW(), 'ACTIVE', ?, ?, 'BETA')`,
            [phone, nationalId, pinHash, openingBalance, currency]
        );

        // TODO: mark the vouchers for this phone as redeemed here
        // (UPDATE <your vouchers table> ...) once the table
        // structure is confirmed.

        await connection.commit();

        return res.status(201).json({
            success: true,
            code: 'REGISTERED',
            message: 'Registration successful.',
            customer: {
                phone_number: phone,
                name: null,
                surname: null,
                wallet_balance: openingBalance,
                currency,
                status: 'ACTIVE',
                account_type: 'BETA'
            }
        });

    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('Rollback error:', rollbackError);
            }
        }

        // Race condition: someone registered between the check and insert.
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                success: false,
                code: 'ALREADY_REGISTERED',
                message: 'This number or National ID is already registered.'
            });
        }

        console.error('Registration error:', error);

        return res.status(500).json({
            success: false,
            code: 'SERVER_ERROR',
            message: 'Unable to complete registration.'
        });

    } finally {
        if (connection) connection.release();
    }
};

// --------------------------------------------------
// REVIEW TRANSFER
// POST /api/ewallet/ussd/review
// --------------------------------------------------
const reviewTransfer = async (req, res) => {
    try {
        const senderPhone = normalizePhone(req.body.sender_phone);
        const recipientPhone = normalizePhone(req.body.recipient_phone);
        const amount = req.body.amount;

        if (!senderPhone || !recipientPhone) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_PHONE',
                message: 'Please provide valid cellphone numbers.'
            });
        }

        if (!validAmount(amount)) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_AMOUNT',
                message: 'Please enter a valid transfer amount.'
            });
        }

        const transferAmount = Number(amount);

        const sender = await findCustomer(senderPhone);

        if (!sender || sender.status !== 'ACTIVE') {
            return res.status(404).json({
                success: false,
                code: 'SENDER_NOT_FOUND',
                message: 'Your eWallet account was not found or is inactive.'
            });
        }

        // BETA accounts must transfer less than E500 per transaction.
        if (
            sender.account_type === 'BETA' &&
            transferAmount >= 500
        ) {
            return res.status(400).json({
                success: false,
                code: 'BETA_LIMIT_EXCEEDED',
                message: 'BETA accounts are limited to transfers below E500 per transaction.'
            });
        }

        const recipient = await findRecipient(recipientPhone);

        if (!recipient || recipient.activity !== 'ACTIVE') {
            return res.status(404).json({
                success: false,
                code: 'RECIPIENT_NOT_FOUND',
                message: 'The recipient is not an active MTN MoMo user.'
            });
        }

        const currentBalance = Number(sender.wallet_balance);

        if (transferAmount > currentBalance) {
            return res.status(400).json({
                success: false,
                code: 'INSUFFICIENT_FUNDS',
                message: 'You have insufficient funds for this transaction.'
            });
        }

        // Name and surname are NULL for new BETA accounts until KYC.
        const senderName =
            `${sender.name || ''} ${sender.surname || ''}`.trim() ||
            'eWallet Customer';

        return res.status(200).json({
            success: true,
            message: 'Transfer details verified.',
            review: {
                sender_name: senderName,
                sender_phone: sender.phone_number,
                recipient_name: recipient.fullname,
                // Already stored in full format (268XXXXXXXX)
                recipient_phone: recipient.phone_number,
                amount: transferAmount,
                currency: sender.currency,
                current_balance: currentBalance,
                balance_after: currentBalance - transferAmount
            }
        });

    } catch (error) {
        console.error('Transfer review error:', error);

        return res.status(500).json({
            success: false,
            code: 'SERVER_ERROR',
            message: 'Unable to review transfer.'
        });
    }
};

// --------------------------------------------------
// AUTHORIZE TRANSFER
// POST /api/ewallet/ussd/authorize
//
// This verifies the PIN only.
// It does NOT deduct funds or credit the recipient.
// --------------------------------------------------
const authorizeTransfer = async (req, res) => {
    try {
        const senderPhone = normalizePhone(req.body.sender_phone);
        const recipientPhone = normalizePhone(req.body.recipient_phone);
        const amount = req.body.amount;
        const pin = String(req.body.pin || '');

        if (!senderPhone || !recipientPhone || !validAmount(amount)) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_DETAILS',
                message: 'Please provide valid transfer details.'
            });
        }

        if (!/^\d{5}$/.test(pin)) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_PIN',
                message: 'Your transaction PIN must contain exactly five digits.'
            });
        }

        const sender = await findCustomer(senderPhone);

        if (!sender || sender.status !== 'ACTIVE') {
            return res.status(404).json({
                success: false,
                code: 'SENDER_NOT_FOUND',
                message: 'Your eWallet account was not found or is inactive.'
            });
        }

        const transferAmount = Number(amount);

        if (
            sender.account_type === 'BETA' &&
            transferAmount >= 500
        ) {
            return res.status(400).json({
                success: false,
                code: 'BETA_LIMIT_EXCEEDED',
                message: 'BETA accounts are limited to transfers below E500 per transaction.'
            });
        }

        const recipient = await findRecipient(recipientPhone);

        if (!recipient || recipient.activity !== 'ACTIVE') {
            return res.status(404).json({
                success: false,
                code: 'RECIPIENT_NOT_FOUND',
                message: 'The recipient is not an active MTN MoMo user.'
            });
        }

        if (transferAmount > Number(sender.wallet_balance)) {
            return res.status(400).json({
                success: false,
                code: 'INSUFFICIENT_FUNDS',
                message: 'You have insufficient funds for this transaction.'
            });
        }

        const pinMatches = await bcrypt.compare(
            pin,
            sender.transaction_password_hash
        );

        if (!pinMatches) {
            return res.status(401).json({
                success: false,
                code: 'INCORRECT_PIN',
                message: 'Incorrect transaction PIN.'
            });
        }

        return res.status(200).json({
            success: true,
            authorized: true,
            stage: 'PRE_CBE_AUTHORIZED',
            transaction_completed: false,
            money_deducted: false,
            recipient_credited: false,
            message: 'PIN verified. The transfer has not yet been processed.'
        });

    } catch (error) {
        console.error('Transfer authorization error:', error);

        return res.status(500).json({
            success: false,
            code: 'SERVER_ERROR',
            message: 'Unable to authorize transfer.'
        });
    }
};

// --------------------------------------------------
// SEND MONEY: eWALLET -> MTN MOMO THROUGH THE CBE SWITCH
// POST /api/ewallet/ussd/send
//
// Body: { sender_phone, recipient_phone, amount, pin, idempotency_key }
//
// 1. Verifies the PIN on the server.
// 2. Hands the transfer to the CBE switch.
//
// PIN problems use HTTP 401 / 400. Every outcome of the switch
// (completed, failed, reversed) is returned with HTTP 200 and
// success true/false, plus the status, code and reference.
// --------------------------------------------------
const sendMoney = async (req, res) => {
    try {
        const senderPhone = normalizePhone(req.body.sender_phone);
        const recipientPhone = normalizePhone(req.body.recipient_phone);
        const amount = req.body.amount;
        const pin = String(req.body.pin || '');
        const idempotencyKey = String(req.body.idempotency_key || '').trim();

        if (!senderPhone || !recipientPhone || !validAmount(amount)) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_DETAILS',
                message: 'Please provide valid transfer details.'
            });
        }

        if (idempotencyKey.length < 8 || idempotencyKey.length > 100) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_IDEMPOTENCY_KEY',
                message: 'A valid request key is required.'
            });
        }

        if (!/^\d{5}$/.test(pin)) {
            return res.status(400).json({
                success: false,
                code: 'INVALID_PIN',
                message: 'Your transaction PIN must contain exactly five digits.'
            });
        }

        if (senderPhone === recipientPhone) {
            return res.status(400).json({
                success: false,
                code: 'SAME_ACCOUNT',
                message: 'You cannot send money to your own number.'
            });
        }

        const sender = await findCustomer(senderPhone);

        if (!sender || sender.status !== 'ACTIVE') {
            return res.status(404).json({
                success: false,
                code: 'SENDER_NOT_FOUND',
                message: 'Your eWallet account was not found or is inactive.'
            });
        }

        const pinMatches = await bcrypt.compare(
            pin,
            sender.transaction_password_hash
        );

        if (!pinMatches) {
            return res.status(401).json({
                success: false,
                code: 'INCORRECT_PIN',
                message: 'Incorrect transaction PIN.'
            });
        }

        const transferAmount = Number(amount);

        if (sender.account_type === 'BETA' && transferAmount >= 500) {
            return res.status(400).json({
                success: false,
                code: 'BETA_LIMIT_EXCEEDED',
                message: 'BETA accounts are limited to transfers below E500 per transaction.'
            });
        }

        const result = await processTransfer({
            idempotencyKey,
            senderPhone,
            recipientPhone,
            amount: transferAmount,
            currency: sender.currency || 'SZL'
        });

        return res.status(200).json(result);

    } catch (error) {
        console.error('Send money error:', error);

        return res.status(500).json({
            success: false,
            code: 'SERVER_ERROR',
            message: 'Unable to process the transfer.'
        });
    }
};

// --------------------------------------------------
// EXPORT CONTROLLER FUNCTIONS
// --------------------------------------------------
module.exports = {
    lookupCustomer,
    lookupRecipient,
    lookupVoucher,
    registerCustomer,
    reviewTransfer,
    authorizeTransfer,
    sendMoney
};