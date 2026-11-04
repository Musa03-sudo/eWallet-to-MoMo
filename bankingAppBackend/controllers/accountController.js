const db = require('../config/db');

const getMyAccount = async (req, res) => {
    try {
        const accountNumber = req.account.account_number;

        const [accounts] = await db.execute(
            `SELECT
                account_number,
                full_name,
                email,
                cellphone,
                balance,
                currency,
                status
             FROM banking_app
             WHERE account_number = ?
             LIMIT 1`,
            [accountNumber]
        );

        if (accounts.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Account not found'
            });
        }

        return res.status(200).json({
            success: true,
            account: accounts[0]
        });

    } catch (error) {
        console.error('Get account error:', error);

        return res.status(500).json({
            success: false,
            message: 'Unable to retrieve account details'
        });
    }
};

module.exports = { getMyAccount };