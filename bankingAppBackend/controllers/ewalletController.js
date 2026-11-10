const pool = require('../config/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// Generate a unique 10-character voucher code.
function generateVoucherCode() {
    return crypto.randomBytes(5).toString('hex').toUpperCase();
}

// Generate exactly five numeric characters.
function generateVoucherPin() {
    return crypto.randomInt(0, 100000)
        .toString()
        .padStart(5, '0');
}

// Convert a monetary amount into cents.
function toCents(value) {
    const amount = String(value ?? '').trim();

    if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
        return null;
    }

    const parts = amount.split('.');
    const whole = BigInt(parts[0]);
    const decimal = BigInt((parts[1] || '').padEnd(2, '0'));

    return whole * 100n + decimal;
}

// Convert cents back into a DECIMAL-compatible string.
function centsToAmount(cents) {
    const whole = cents / 100n;
    const decimal = (cents % 100n).toString().padStart(2, '0');

    return `${whole}.${decimal}`;
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
        amount: centsToAmount(amountCents),
        sendPin: body.send_pin === true
    };
}

// Generate a unique transaction reference.
function generateReference() {
    return `EW${Date.now()}${crypto.randomBytes(4)
        .toString('hex')
        .toUpperCase()}`;
}

// --------------------------------------------------
// CHECK RECIPIENT
// POST /api/ewallet/recipient/check
// --------------------------------------------------
exports.checkRecipient = async (req, res) => {
    try {
        const recipientPhone = String(
            req.body.recipient_phone || ''
        ).trim();

        if (!/^268\d{8}$/.test(recipientPhone)) {
            return res.status(400).json({
                success: false,
                message: 'Enter a valid Eswatini cellphone number.'
            });
        }

        const [customers] = await pool.execute(
            `SELECT
                phone_number,
                name,
                surname,
                status
             FROM ewallet_customers
             WHERE phone_number = ?
             LIMIT 1`,
            [recipientPhone]
        );

        if (customers.length === 0) {
            return res.status(200).json({
                success: true,
                registered: false,
                message: 'Recipient is not a registered eWallet customer.',
                recipient_phone: recipientPhone
            });
        }

        const customer = customers[0];

        if (customer.status !== 'ACTIVE') {
            return res.status(403).json({
                success: false,
                registered: true,
                message: 'This eWallet customer account is blocked.'
            });
        }

        return res.status(200).json({
            success: true,
            registered: true,
            message: 'Registered eWallet customer found.',
            customer: {
                phone_number: customer.phone_number,
                name: customer.name,
                surname: customer.surname
            }
        });

    } catch (error) {
        console.error('RECIPIENT CHECK ERROR:', error);

        return res.status(500).json({
            success: false,
            message: 'Unable to check recipient.'
        });
    }
};

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

        // Check recipient registration.
        const [customers] = await pool.execute(
            `SELECT phone_number, name, surname, status, currency
             FROM ewallet_customers
             WHERE phone_number = ?
             LIMIT 1`,
            [recipientCellphone]
        );

        let recipient = null;

        if (customers.length > 0) {
            recipient = customers[0];

            if (recipient.status !== 'ACTIVE') {
                return res.status(403).json({
                    success: false,
                    message: 'Recipient eWallet account is blocked.'
                });
            }

            if (recipient.currency !== account.currency) {
                return res.status(400).json({
                    success: false,
                    message: 'Sender and recipient currencies do not match.'
                });
            }
        }

        const balanceAfterCents =
            currentBalanceCents - amountCents;

        return res.status(200).json({
            success: true,
            message: 'eWallet payment review successful.',
            recipient_registered: Boolean(recipient),
            recipient: recipient
                ? {
                    phone_number: recipient.phone_number,
                    name: recipient.name,
                    surname: recipient.surname
                }
                : null,
            from_account: String(account.account_number),
            from_name: account.full_name,
            recipient_cellphone: recipientCellphone,
            amount: amount,
            currency: account.currency,
            send_pin: recipient ? false : sendPin,
            balance_after: centsToAmount(balanceAfterCents)
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
// SEND EWALLET PAYMENT
// POST /api/ewallet/send
//
// Registered recipient:
// Bank debit + eWallet credit + BANK_CREDIT transaction.
//
// Unregistered recipient:
// Bank debit + voucher creation.
// --------------------------------------------------
exports.sendEwallet = async (req, res) => {
    let connection;
    let transactionStarted = false;

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
        transactionStarted = true;

        // 1. Lock sender's bank account.
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
            transactionStarted = false;

            return res.status(404).json({
                success: false,
                message: 'Sender account was not found.'
            });
        }

        const account = accounts[0];

        if (account.status !== 'ACTIVE') {
            await connection.rollback();
            transactionStarted = false;

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
            transactionStarted = false;

            return res.status(400).json({
                success: false,
                message: 'Insufficient account balance.'
            });
        }

        // 2. Check and lock recipient's eWallet account.
        const [customers] = await connection.execute(
            `SELECT
                phone_number,
                name,
                surname,
                wallet_balance,
                currency,
                status
             FROM ewallet_customers
             WHERE phone_number = ?
             LIMIT 1
             FOR UPDATE`,
            [recipientCellphone]
        );

        const newBankBalanceCents =
            currentBalanceCents - amountCents;

        const newBankBalance =
            centsToAmount(newBankBalanceCents);

        // 3. REGISTERED RECIPIENT: Direct wallet credit.
        if (customers.length > 0) {
            const recipient = customers[0];

            if (recipient.status !== 'ACTIVE') {
                await connection.rollback();
                transactionStarted = false;

                return res.status(403).json({
                    success: false,
                    registered: true,
                    message: 'Recipient eWallet account is blocked.'
                });
            }

            if (recipient.currency !== account.currency) {
                await connection.rollback();
                transactionStarted = false;

                return res.status(400).json({
                    success: false,
                    message: 'Sender and recipient currencies do not match.'
                });
            }

            const recipientBalanceCents =
                toCents(recipient.wallet_balance);

            if (recipientBalanceCents === null) {
                throw new Error('Recipient wallet balance is invalid.');
            }

            const newRecipientBalanceCents =
                recipientBalanceCents + amountCents;

            const newRecipientBalance =
                centsToAmount(newRecipientBalanceCents);

            // Debit sender.
            const [debitResult] = await connection.execute(
                `UPDATE banking_app
                 SET balance = ?
                 WHERE account_number = ?
                   AND status = 'ACTIVE'`,
                [newBankBalance, senderAccountNumber]
            );

            if (debitResult.affectedRows !== 1) {
                throw new Error('Unable to debit sender bank account.');
            }

            // Credit recipient.
            const [creditResult] = await connection.execute(
                `UPDATE ewallet_customers
                 SET wallet_balance = ?
                 WHERE phone_number = ?
                   AND status = 'ACTIVE'`,
                [newRecipientBalance, recipientCellphone]
            );

            if (creditResult.affectedRows !== 1) {
                throw new Error('Unable to credit recipient eWallet.');
            }

            // Record the wallet credit.
            const referenceNumber = generateReference();

            await connection.execute(
                `INSERT INTO ewallet_transactions
                 (
                    reference_number,
                    phone_number,
                    sender_account_number,
                    transaction_type,
                    amount,
                    currency,
                    recipient_phone,
                    status
                 )
                 VALUES (?, ?, ?, 'BANK_CREDIT', ?, ?, ?, 'SUCCESS')`,
                [
                    referenceNumber,
                    recipientCellphone,
                    senderAccountNumber,
                    amount,
                    account.currency,
                    recipientCellphone
                ]
            );

            // Commit all three database changes together.
            await connection.commit();
            transactionStarted = false;

            // These are message previews, not real SMS messages.
            const senderSmsPreview =
                `Uneswa Bank: Your transfer of ${account.currency} ${amount} to ${recipient.name} ${recipient.surname} (${recipientCellphone}) was successful. Reference: ${referenceNumber}.`;

            const recipientSmsPreview =
                `Uneswa eWallet: You have received ${account.currency} ${amount} from ${account.full_name}. Your new wallet balance is ${account.currency} ${newRecipientBalance}. Reference: ${referenceNumber}.`;

            return res.status(200).json({
                success: true,
                registered: true,
                transaction_type: 'BANK_CREDIT',
                message: 'Transfer completed successfully.',
                reference_number: referenceNumber,

                sender: {
                    account_number: String(account.account_number),
                    name: account.full_name,
                    new_balance: newBankBalance,
                    currency: account.currency
                },

                recipient: {
                    phone_number: recipient.phone_number,
                    name: recipient.name,
                    surname: recipient.surname,
                    credited_amount: amount,
                    new_wallet_balance: newRecipientBalance,
                    currency: recipient.currency
                },

                voucher_generated: false,

                sms: {
                    sent: false,
                    sender_preview: senderSmsPreview,
                    recipient_preview: recipientSmsPreview,
                    message: 'SMS delivery is not configured. These are previews only.'
                }
            });
        }

        // 4. UNREGISTERED RECIPIENT: Create voucher.
        const voucherCode = generateVoucherCode();
        const voucherPin = generateVoucherPin();

        const pinHash = await bcrypt.hash(voucherPin, 10);

        // Debit sender.
        const [debitResult] = await connection.execute(
            `UPDATE banking_app
             SET balance = ?
             WHERE account_number = ?
               AND status = 'ACTIVE'`,
            [newBankBalance, senderAccountNumber]
        );

        if (debitResult.affectedRows !== 1) {
            throw new Error('Unable to debit sender bank account.');
        }

        // Create voucher and initialize remaining balance.
        await connection.execute(
            `INSERT INTO ewallet_voucher
             (
                voucher_code,
                sender_account_number,
                recipient_cellphone,
                amount,
                currency,
                pin_hash,
                status,
                remaining_balance,
                transferred_amount,
                reserved_balance
             )
             VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, 0.00, 0.00)`,
            [
                voucherCode,
                senderAccountNumber,
                recipientCellphone,
                amount,
                account.currency,
                pinHash,
                amount
            ]
        );

        await connection.commit();
        transactionStarted = false;

        const voucherSmsPreview = sendPin
            ? `Uneswa Bank eWallet: You have received ${account.currency} ${amount}. Voucher code: ${voucherCode}. Voucher PIN: ${voucherPin}.`
            : `Uneswa Bank eWallet: You have received ${account.currency} ${amount}. Voucher code: ${voucherCode}. Your voucher PIN has not been included in this message.`;

        return res.status(201).json({
            success: true,
            registered: false,
            transaction_type: 'VOUCHER',
            message: 'eWallet voucher created successfully.',
            voucher_generated: true,

            voucher: {
                voucher_code: voucherCode,
                recipient_cellphone: recipientCellphone,
                amount: amount,
                remaining_balance: amount,
                currency: account.currency,
                status: 'ACTIVE'
            },

            sender: {
                account_number: String(account.account_number),
                new_balance: newBankBalance,
                currency: account.currency
            },

            sms: {
                sent: false,
                preview: voucherSmsPreview,
                message: 'SMS delivery is not configured. This is a preview only.'
            }
        });

    } catch (error) {
        if (connection && transactionStarted) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('EWALLET ROLLBACK ERROR:', rollbackError);
            }
        }

        console.error('EWALLET SEND ERROR:', error);

        return res.status(500).json({
            success: false,
            message: 'Unable to process eWallet transfer.'
        });

    } finally {
        if (connection) {
            connection.release();
        }
    }
};