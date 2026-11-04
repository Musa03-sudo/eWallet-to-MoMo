
const pool = require('../config/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// Generate a unique 10-character voucher code.
function generateVoucherCode() {
    return crypto.randomBytes(5).toString('hex').toUpperCase();
}

// Generate exactly five numeric characters.
// Example: 04721, 58304, 91235.
function generateVoucherPin() {
    return crypto.randomInt(0, 100000)
        .toString()
        .padStart(5, '0');
}

// Convert an amount into cents to avoid floating-point
// comparison problems when checking account balances.
function toCents(value) {
    const amount = String(value).trim();

    if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
        return null;
    }

    const parts = amount.split('.');
    const whole = BigInt(parts[0]);
    const decimal = BigInt((parts[1] || '').padEnd(2, '0') || '0');

    return whole * 100n + decimal;
}

function validateEwalletRequest(body) {
    const recipientCellphone = String(
        body.recipient_cellphone || ''
    ).trim();

    const amountCents = toCents(body.amount);

    if (!/^268\d{8}$/.test(recipientCellphone)) {
        return {
            valid: false,
            message: 'Enter a valid Eswatini cellphone number starting with 268.'
        };
    }

    if (amountCents === null || amountCents <= 0n) {
        return {
            valid: false,
            message: 'Enter a valid amount greater than zero, with a maximum of two decimal places.'
        };
    }

    if (
        body.send_pin !== undefined &&
        typeof body.send_pin !== 'boolean'
    ) {
        return {
            valid: false,
            message: 'Invalid voucher PIN delivery option.'
        };
    }

    return {
        valid: true,
        recipientCellphone,
        amountCents,
        amount: (Number(amountCents) / 100).toFixed(2),
        sendPin: body.send_pin === true
    };
}

// --------------------------------------------------
// REVIEW EWALLET PAYMENT
// POST /api/ewallet/review
// --------------------------------------------------
exports.reviewEwallet = async (req, res) => {
    try {
        const validation = validateEwalletRequest(req.body);

        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                message: validation.message
            });
        }

        // Account number comes from the authenticated JWT.
        const senderAccountNumber = req.account.account_number;

        const {
            recipientCellphone,
            amountCents,
            amount,
            sendPin
        } = validation;

        const [accounts] = await pool.execute(
            `SELECT
                account_number,
                full_name,
                balance,
                currency,
                status
             FROM banking_app
             WHERE account_number = ?
             LIMIT 1`,
            [senderAccountNumber]
        );

        if (accounts.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Sender account was not found.'
            });
        }

        const account = accounts[0];

        if (account.status !== 'ACTIVE') {
            return res.status(403).json({
                success: false,
                message: 'Your account is not active.'
            });
        }

        const currentBalanceCents = toCents(account.balance);

        if (
            currentBalanceCents === null ||
            currentBalanceCents < amountCents
        ) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient account balance.'
            });
        }

        const balanceAfterCents =
            currentBalanceCents - amountCents;

        return res.status(200).json({
            success: true,
            message: 'eWallet payment review successful.',
            from_account: String(account.account_number),
            from_name: account.full_name,
            recipient_cellphone: recipientCellphone,
            amount: Number(amount),
            currency: account.currency,
            send_pin: sendPin,
            balance_after: Number(balanceAfterCents) / 100
        });

    } catch (error) {
        console.error('EWALLET REVIEW ERROR:', error);

        return res.status(500).json({
            success: false,
            message: 'Unable to review eWallet payment.'
        });
    }
};


// --------------------------------------------------
// SEND EWALLET PAYMENT / CREATE VOUCHER
// POST /api/ewallet/send
// --------------------------------------------------
exports.sendEwallet = async (req, res) => {
    let connection;

    try {
        const validation = validateEwalletRequest(req.body);

        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                message: validation.message
            });
        }

        const senderAccountNumber = req.account.account_number;

        const {
            recipientCellphone,
            amountCents,
            amount,
            sendPin
        } = validation;

        connection = await pool.getConnection();

        await connection.beginTransaction();

        // Lock the sender's account while processing the payment.
        const [accounts] = await connection.execute(
            `SELECT
                account_number,
                full_name,
                balance,
                currency,
                status
             FROM banking_app
             WHERE account_number = ?
             LIMIT 1
             FOR UPDATE`,
            [senderAccountNumber]
        );

        if (accounts.length === 0) {
            await connection.rollback();

            return res.status(404).json({
                success: false,
                message: 'Sender account was not found.'
            });
        }

        const account = accounts[0];

        if (account.status !== 'ACTIVE') {
            await connection.rollback();

            return res.status(403).json({
                success: false,
                message: 'Your account is not active.'
            });
        }

        const currentBalanceCents = toCents(account.balance);

        if (
            currentBalanceCents === null ||
            currentBalanceCents < amountCents
        ) {
            await connection.rollback();

            return res.status(400).json({
                success: false,
                message: 'Insufficient account balance.'
            });
        }

        const newBalanceCents =
            currentBalanceCents - amountCents;

        const newBalance =
            (Number(newBalanceCents) / 100).toFixed(2);

        // Generate voucher code and five-digit voucher PIN.
        const voucherCode = generateVoucherCode();
        const voucherPin = generateVoucherPin();

        // Hash the voucher PIN before saving it.
        const pinHash = await bcrypt.hash(voucherPin, 10);

        // Deduct the sender's balance.
        const [updateResult] = await connection.execute(
            `UPDATE banking_app
             SET balance = ?
             WHERE account_number = ?
               AND status = 'ACTIVE'`,
            [newBalance, senderAccountNumber]
        );

        if (updateResult.affectedRows !== 1) {
            throw new Error('Unable to update sender account balance.');
        }

        // Insert the voucher using the actual database columns.
        await connection.execute(
            `INSERT INTO ewallet_voucher
             (
                voucher_code,
                sender_account_number,
                recipient_cellphone,
                amount,
                currency,
                pin_hash,
                status
             )
             VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
            [
                voucherCode,
                senderAccountNumber,
                recipientCellphone,
                amount,
                account.currency,
                pinHash
            ]
        );

        // Commit voucher creation and balance deduction together.
        await connection.commit();

        // Simulated SMS preview. This does NOT send a real SMS.
        const smsPreview = sendPin
            ? `Uneswa Bank eWallet: You have received ${account.currency} ${amount}. Voucher code: ${voucherCode}. Voucher PIN: ${voucherPin}.`
            : `Uneswa Bank eWallet: You have received ${account.currency} ${amount}. Voucher code: ${voucherCode}. Your voucher PIN has not been included in this message.`;

        return res.status(201).json({
            success: true,
            message: 'eWallet voucher created successfully.',
            voucher_code: voucherCode,
            recipient_cellphone: recipientCellphone,
            amount: Number(amount),
            currency: account.currency,
            new_balance: Number(newBalance),
            sms_preview: smsPreview
        });

    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error(
                    'EWALLET ROLLBACK ERROR:',
                    rollbackError
                );
            }
        }

        console.error('EWALLET SEND ERROR:', error);

        return res.status(500).json({
            success: false,
            message: 'Unable to create eWallet voucher.'
        });

    } finally {
        if (connection) {
            connection.release();
        }
    }
};
