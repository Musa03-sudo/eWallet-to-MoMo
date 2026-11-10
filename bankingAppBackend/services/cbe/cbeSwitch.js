// CBE payment switch.
// Touches ONLY cbe_* tables. It talks to the institutions through
// their service functions and never reads their balances directly.
const pool = require('../../config/db');
const { generateReference } = require('./cbeReference');
const ledger = require('./cbeLedger');
const ewallet = require('../institutions/ewalletInstitution');
const momo = require('../institutions/momoInstitution');

// cbe_accounts.account_prefix values
const SOURCE = 'uneswa';
const DESTINATION = 'mtn';
const TRANSACTION_TYPE = 'EWALLET_TO_MOMO';

const OPEN_STATUSES = ['PENDING', 'DEBITED'];

// --------------------------------------------------
// DATABASE HELPERS
// --------------------------------------------------
async function findByIdempotencyKey(key) {
    const [rows] = await pool.execute(
        `SELECT *
         FROM cbe_payment_transactions
         WHERE idempotency_key = ?
         LIMIT 1`,
        [key]
    );

    return rows[0] || null;
}

// Inserts the PENDING row. Returns { reference } or { duplicate: true }.
async function createTransaction({ idempotencyKey, senderPhone, recipientPhone, amount, currency }) {
    for (let attempt = 0; attempt < 5; attempt++) {
        const reference = generateReference();

        try {
            await pool.execute(
                `INSERT INTO cbe_payment_transactions
                    (transaction_reference, idempotency_key, voucher_code,
                     source_institution, destination_institution,
                     sender_account, recipient_phone, amount, currency,
                     transaction_type, status)
                 VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
                [
                    reference, idempotencyKey,
                    SOURCE, DESTINATION,
                    senderPhone, recipientPhone, amount, currency,
                    TRANSACTION_TYPE
                ]
            );

            return { reference };

        } catch (error) {
            if (error.code !== 'ER_DUP_ENTRY') throw error;

            // Same idempotency key sent at the same moment.
            if (String(error.sqlMessage).includes('idempotency_key')) {
                return { duplicate: true };
            }

            // Reference collision: loop and generate another one.
        }
    }

    throw new Error('Could not generate a unique CBE reference.');
}

async function updateTransaction(reference, status, code, message, isFinal) {
    await pool.execute(
        `UPDATE cbe_payment_transactions
         SET status = ?,
             response_code = ?,
             response_message = ?,
             completed_at = CASE WHEN ? THEN NOW() ELSE completed_at END
         WHERE transaction_reference = ?`,
        [status, code, message, isFinal ? 1 : 0, reference]
    );
}

// Updates the CBE row and builds the result returned to the app.
async function finish(reference, status, code, message, context, isFinal = true, extra = {}) {
    await updateTransaction(reference, status, code, message, isFinal);

    const senderBalance = await ewallet.getBalance(context.senderPhone);

    return {
        success: status === 'COMPLETED',
        status,
        code,
        message,
        reference,
        amount: context.amount,
        currency: context.currency,
        sender_balance: senderBalance,
        ...extra
    };
}

// Result for a request that was already processed (same idempotency key).
async function resultFromRow(row) {
    const senderBalance = await ewallet.getBalance(row.sender_account);

    if (OPEN_STATUSES.includes(row.status)) {
        return {
            success: false,
            status: row.status,
            code: '94',
            message: 'Your previous request is still being processed.',
            reference: row.transaction_reference,
            amount: Number(row.amount),
            currency: row.currency,
            sender_balance: senderBalance
        };
    }

    return {
        success: row.status === 'COMPLETED',
        status: row.status,
        code: row.response_code,
        message: row.response_message,
        reference: row.transaction_reference,
        amount: Number(row.amount),
        currency: row.currency,
        sender_balance: senderBalance
    };
}

// --------------------------------------------------
// COMPENSATION (undo what already happened)
// --------------------------------------------------
async function compensate({ reference, senderPhone, recipientPhone, amount, debited, settled }) {
    let allReversed = true;

    if (settled) {
        try {
            await ledger.reverseSettlement({
                reference,
                fromPrefix: SOURCE,
                toPrefix: DESTINATION,
                amount
            });
        } catch (error) {
            console.error('CBE settlement reversal failed:', error);
            allReversed = false;
        }
    }

    if (debited) {
        const refund = await ewallet.reverse({
            reference,
            phone: senderPhone,
            counterparty: recipientPhone,
            amount
        });

        if (!refund.ok) allReversed = false;
    }

    return allReversed;
}

// --------------------------------------------------
// PROCESS TRANSFER (eWallet -> MoMo)
// --------------------------------------------------
async function processTransfer({
    idempotencyKey,
    senderPhone,
    recipientPhone,
    amount,
    currency = 'SZL'
}) {
    // 1. Duplicate request?
    const existing = await findByIdempotencyKey(idempotencyKey);
    if (existing) return resultFromRow(existing);

    // 2. PENDING: CBE accepts the request and issues a reference.
    const created = await createTransaction({
        idempotencyKey, senderPhone, recipientPhone, amount, currency
    });

    if (created.duplicate) {
        const row = await findByIdempotencyKey(idempotencyKey);
        if (row) return resultFromRow(row);

        return {
            success: false,
            status: 'PENDING',
            code: '94',
            message: 'Your previous request is still being processed.',
            reference: null,
            amount,
            currency,
            sender_balance: await ewallet.getBalance(senderPhone)
        };
    }

    const reference = created.reference;
    const context = { senderPhone, recipientPhone, amount, currency };

    let debited = false;
    let settled = false;

    try {
        // 3. Can the recipient receive money?
        const recipient = await momo.validateRecipient(recipientPhone);

        if (!recipient.ok) {
            return finish(reference, 'FAILED', recipient.code, recipient.message, context);
        }

        // 4. DEBITED: eWallet takes the money from the sender.
        const debit = await ewallet.debit({
            reference,
            phone: senderPhone,
            counterparty: recipientPhone,
            amount
        });

        if (!debit.ok) {
            return finish(reference, 'FAILED', debit.code, debit.message, context);
        }

        debited = true;

        await updateTransaction(
            reference, 'DEBITED', null,
            'Sender debited. Settling with MTN MoMo.', false
        );

        // 5. CBE settlement between institution accounts (+ 2 ledger rows).
        await ledger.settle({
            reference,
            fromPrefix: SOURCE,
            toPrefix: DESTINATION,
            amount
        });

        settled = true;

        // 6. MoMo credits the recipient.
        const credit = await momo.credit({
            reference,
            phone: recipientPhone,
            counterparty: senderPhone,
            amount
        });

        if (!credit.ok) {
            const reversed = await compensate({
                reference, senderPhone, recipientPhone, amount, debited, settled
            });

            if (reversed) {
                return finish(
                    reference, 'REVERSED', credit.code,
                    `${credit.message} Your money has been refunded.`,
                    context
                );
            }

            return finish(
                reference, 'DEBITED', '96',
                'The transfer failed and the refund needs manual reconciliation.',
                context, false
            );
        }

        // 7. COMPLETED
        return finish(
            reference, 'COMPLETED', '00',
            'Transfer completed successfully.',
            context, true,
            { recipient_name: recipient.fullname }
        );

    } catch (error) {
        console.error('CBE processTransfer error:', error);

        const reversed = await compensate({
            reference, senderPhone, recipientPhone, amount, debited, settled
        });

        if (!debited) {
            return finish(
                reference, 'FAILED', '96',
                'The payment switch could not process the transfer.',
                context
            );
        }

        if (reversed) {
            return finish(
                reference, 'REVERSED', '96',
                'The transfer could not be completed. Your money has been refunded.',
                context
            );
        }

        return finish(
            reference, 'DEBITED', '96',
            'The transfer failed and the refund needs manual reconciliation.',
            context, false
        );
    }
}

module.exports = { processTransfer };