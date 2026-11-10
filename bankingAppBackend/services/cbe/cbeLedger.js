const pool = require('../../config/db');

const round2 = (value) => Math.round(Number(value) * 100) / 100;

// --------------------------------------------------
// Moves money between two institution accounts held at the CBE
// and writes two ledger rows (DEBIT + CREDIT) in cbe_transaction_logs.
// Runs inside the caller's connection/transaction.
// --------------------------------------------------
async function moveBetweenAccounts(
    connection,
    { reference, fromPrefix, toPrefix, amount }
) {
    // Lock both rows in a fixed order (by account number) to avoid deadlocks.
    const [rows] = await connection.execute(
        `SELECT
            account_number,
            account_name,
            account_prefix,
            Total_balance AS total_balance,
            status
         FROM cbe_accounts
         WHERE account_prefix IN (?, ?)
         ORDER BY account_number
         FOR UPDATE`,
        [fromPrefix, toPrefix]
    );

    const from = rows.find((row) => row.account_prefix === fromPrefix);
    const to = rows.find((row) => row.account_prefix === toPrefix);

    if (!from || !to || from.status !== 'ACTIVE' || to.status !== 'ACTIVE') {
        throw new Error('CBE_ACCOUNT_UNAVAILABLE');
    }

    const fromBefore = Number(from.total_balance);
    const toBefore = Number(to.total_balance);

    if (fromBefore < amount) {
        throw new Error('CBE_INSUFFICIENT_LIQUIDITY');
    }

    const fromAfter = round2(fromBefore - amount);
    const toAfter = round2(toBefore + amount);

    await connection.execute(
        'UPDATE cbe_accounts SET Total_balance = ? WHERE account_number = ?',
        [fromAfter, from.account_number]
    );

    await connection.execute(
        'UPDATE cbe_accounts SET Total_balance = ? WHERE account_number = ?',
        [toAfter, to.account_number]
    );

    const insertLog = `INSERT INTO cbe_transaction_logs
        (transaction_reference, account_number, account_name,
         previous_balance, amount, activity, current_balance)
        VALUES (?, ?, ?, ?, ?, ?, ?)`;

    await connection.execute(insertLog, [
        reference, from.account_number, from.account_name,
        fromBefore, amount, 'DEBIT', fromAfter
    ]);

    await connection.execute(insertLog, [
        reference, to.account_number, to.account_name,
        toBefore, amount, 'CREDIT', toAfter
    ]);
}

async function runInTransaction(work) {
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();
        await work(connection);
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

// Sender institution -> destination institution
function settle({ reference, fromPrefix, toPrefix, amount }) {
    return runInTransaction((connection) =>
        moveBetweenAccounts(connection, { reference, fromPrefix, toPrefix, amount })
    );
}

// Opposite direction, as new rows (history is never edited)
function reverseSettlement({ reference, fromPrefix, toPrefix, amount }) {
    return runInTransaction((connection) =>
        moveBetweenAccounts(connection, {
            reference,
            fromPrefix: toPrefix,
            toPrefix: fromPrefix,
            amount
        })
    );
}

module.exports = { settle, reverseSettlement };