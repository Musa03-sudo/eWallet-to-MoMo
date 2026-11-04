
const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const login = async (req, res) => {
    try {
        const identifier = String(req.body.identifier || '').trim();
        const password = req.body.password;

        // Validate input
        if (!identifier || !password) {
            return res.status(400).json({
                success: false,
                message: 'Account number/email/phone and password are required'
            });
        }

        // Find customer by account number, email or cellphone
        const [customers] = await db.execute(
            `SELECT
                account_number,
                full_name,
                email,
                cellphone,
                password_hash,
                balance,
                currency,
                status
             FROM banking_app
             WHERE account_number = ?
                OR email = ?
                OR cellphone = ?
             LIMIT 1`,
            [identifier, identifier, identifier]
        );

        if (customers.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Invalid login credentials'
            });
        }

        const customer = customers[0];

        // Check account status
        if (customer.status !== 'ACTIVE') {
            return res.status(403).json({
                success: false,
                message: 'Your account is not active. Please contact the bank.'
            });
        }

        // Verify password
        const passwordMatch = await bcrypt.compare(
            password,
            customer.password_hash
        );

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: 'Invalid login credentials'
            });
        }


        if (!process.env.JWT_SECRET) {
       throw new Error('JWT_SECRET is not configured');
            }
        // Generate JWT
        const token = jwt.sign(
            {
                account_number: customer.account_number
            },
            process.env.JWT_SECRET,
            {
                expiresIn: process.env.JWT_EXPIRES_IN || '1h'
            }
        );

        // Return customer details (never return password_hash)
        return res.status(200).json({
            success: true,
            message: 'Login successful',
            token,
            customer: {
                account_number: customer.account_number,
                full_name: customer.full_name,
                email: customer.email,
                cellphone: customer.cellphone,
                balance: customer.balance,
                currency: customer.currency
            }
        });

    } catch (error) {
        console.error('Login error:', error);

        return res.status(500).json({
            success: false,
            message: 'An error occurred during login'
        });
    }
};

module.exports = { login };
