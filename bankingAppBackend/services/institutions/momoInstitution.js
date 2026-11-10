// MTN MoMo institution.
// Touches ONLY momo_active_users and momo_transactions.
const pool = require('../../config/db');

const round2 = (value) => Math.round(Number(value) * 100) / 100;

// Demo failure switch. In .env:
// MOMO_FAIL_CREDIT_PHONES=26876456789
function shouldSimulateFailure(phone) {
    return (process.env.MOMO_FAIL_CREDIT_PHONES || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .includes(phone);
}

// Can this number receive money?
async function validateRecipient(phone) {
    try {
        const [rows] = await pool.execute(
            `SELECT phone_number, fullname, activity
             FROM momo_active_users
             WHERE phone_number = ?
             LIMIT 1`,
            [phone]
        );

        if (rows.length === 0) {
            return {
                ok: false,
                code: '14',
                message: 'The recipient is not registered with MTN MoMo.'
            };
        }

        if (rows[0].activity !== 'ACTIVE') {
            return {
                ok: false,
                code: '14',
                message: 'The recipient MoMo account is not active.'
            };
        }

        return { ok: true, fullname: rows[0].fullname };

    } catch (error) {
        console.error('MoMo validation error:', error);

        return {
            ok: false,
            code: '96',
            message: 'MTN MoMo could not validate the recipient.'
        };
    }
}

// Adds the money to the recipient (one local DB transaction).
async function credit({ reference, phone, counterparty, amount }) {
    if (shouldSimulateFailure(phone)) {
        return {
            ok: false,
            code: '91',
            message: 'MTN MoMo is currently unavailable.'
        };
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const [rows] = await connection.execute(
            `SELECT balance, activity
             FROM momo_active_users
             WHERE phone_number = ?
             FOR UPDATE`,
            [phone]
        );

        if (rows.length === 0 || rows[0].activity !== 'ACTIVE') {
            await connection.rollback();
            return {
                ok: false,
                code: '14',
                message: 'The recipient MoMo account is not active.'
            };
        }

        const before = Number(rows[0].balance);
        const after = round2(before + amount);

        await connection.execute(
            'UPDATE momo_active_users SET balance = ? WHERE phone_number = ?',
            [after, phone]
        );

        await connection.execute(
            `INSERT INTO momo_transactions
                (cbe_reference, phone_number, entry_type, counterparty,
                 amount, balance_before, balance_after)
             VALUES (?, ?, 'CREDIT', ?, ?, ?, ?)`,
            [reference, phone, counterparty, amount, before, after]
        );

        await connection.commit();

        return { ok: true, balanceAfter: after };

    } catch (error) {
        await connection.rollback();
        console.error('MoMo credit error:', error);

        return {
            ok: false,
            code: '91',
            message: 'MTN MoMo could not credit the recipient.'
        };

    } finally {
        connection.release();
    }
}

module.exports = { validateRecipient, credit };