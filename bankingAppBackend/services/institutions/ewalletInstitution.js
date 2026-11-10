// Uneswa eWallet institution.
// Touches ONLY ewallet_customers and ewallet_ledger.
const pool = require('../../config/db');

const round2 = (value) => Math.round(Number(value) * 100) / 100;

async function getBalance(phone) {
    try {
        const [rows] = await pool.execute(
            `SELECT wallet_balance
             FROM ewallet_customers
             WHERE phone_number = ?
             LIMIT 1`,
            [phone]
        );

        return rows.length ? Number(rows[0].wallet_balance) : null;
    } catch (error) {
        console.error('eWallet balance error:', error);
        return null;
    }
}

// Takes the money from the sender (one local DB transaction).
async function debit({ reference, phone, counterparty, amount }) {
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [rows] = await connection.execute(
            `SELECT wallet_balance, status
             FROM ewallet_customers
             WHERE phone_number = ?
             FOR UPDATE`,
            [phone]
        );

        if (rows.length === 0 || rows[0].status !== 'ACTIVE') {
            await connection.rollback();
            return {
                ok: false,
                code: '96',
                message: 'Your eWallet account is unavailable.'
            };
        }

        const before = Number(rows[0].wallet_balance);

        if (before < amount) {
            await connection.rollback();
            return {
                ok: false,
                code: '51',
                message: 'You have insufficient funds for this transaction.'
            };
        }

        const after = round2(before - amount);

        await connection.execute(
            'UPDATE ewallet_customers SET wallet_balance = ? WHERE phone_number = ?',
            [after, phone]
        );

        await connection.execute(
            `INSERT INTO ewallet_ledger
                (cbe_reference, phone_number, entry_type, counterparty,
                 amount, balance_before, balance_after)
             VALUES (?, ?, 'DEBIT', ?, ?, ?, ?)`,
            [reference, phone, counterparty, amount, before, after]
        );

        await connection.commit();

        return { ok: true, balanceBefore: before, balanceAfter: after };

    } catch (error) {
        await connection.rollback();

        if (error.code === 'ER_DUP_ENTRY') {
            return {
                ok: false,
                code: '94',
                message: 'Duplicate request detected.'
            };
        }

        console.error('eWallet debit error:', error);

        return {
            ok: false,
            code: '96',
            message: 'eWallet could not process the debit.'
        };

    } finally {
        connection.release();
    }
}

// Refunds a debit. Safe to call twice (the unique key blocks a second REVERSAL).
async function reverse({ reference, phone, counterparty, amount }) {
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [entries] = await connection.execute(
            `SELECT entry_type
             FROM ewallet_ledger
             WHERE cbe_reference = ? AND phone_number = ?
             FOR UPDATE`,
            [reference, phone]
        );

        const hasDebit = entries.some((row) => row.entry_type === 'DEBIT');
        const hasReversal = entries.some((row) => row.entry_type === 'REVERSAL');

        // Nothing to refund, or already refunded.
        if (!hasDebit || hasReversal) {
            await connection.rollback();
            return { ok: true, skipped: true };
        }

        const [rows] = await connection.execute(
            `SELECT wallet_balance
             FROM ewallet_customers
             WHERE phone_number = ?
             FOR UPDATE`,
            [phone]
        );

        const before = Number(rows[0].wallet_balance);
        const after = round2(before + amount);

        await connection.execute(
            'UPDATE ewallet_customers SET wallet_balance = ? WHERE phone_number = ?',
            [after, phone]
        );

        await connection.execute(
            `INSERT INTO ewallet_ledger
                (cbe_reference, phone_number, entry_type, counterparty,
                 amount, balance_before, balance_after)
             VALUES (?, ?, 'REVERSAL', ?, ?, ?, ?)`,
            [reference, phone, counterparty, amount, before, after]
        );

        await connection.commit();

        return { ok: true, balanceAfter: after };

    } catch (error) {
        await connection.rollback();
        console.error('eWallet reversal error:', error);
        return { ok: false };

    } finally {
        connection.release();
    }
}

module.exports = { getBalance, debit, reverse };
