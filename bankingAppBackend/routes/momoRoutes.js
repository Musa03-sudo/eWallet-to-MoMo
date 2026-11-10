
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is missing from environment variables');
}

// Normalize Eswatini mobile numbers
function normalizePhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');

    if (digits.length === 8) return `268${digits}`;
    if (digits.length === 11 && digits.startsWith('268')) return digits;

    return null;
}

// Verify mobile number and PIN
router.post('/verify-pin', async (req, res) => {
    try {
        const { phone_number, pin } = req.body;

        const phone = normalizePhone(phone_number);

        if (!phone || !/^\d{5}$/.test(String(pin || ''))) {
            return res.status(400).json({
                success: false,
                message: 'Enter a valid mobile number and five-digit PIN.'
            });
        }

        const [rows] = await db.query(
            `SELECT phone_number, fullname, activity, pin_hash
             FROM momo_active_users
             WHERE phone_number = ?
             LIMIT 1`,
            [phone]
        );

        if (rows.length === 0 || rows[0].activity !== 'ACTIVE') {
            return res.status(401).json({
                success: false,
                message: 'Invalid mobile number or inactive account.'
            });
        }

        const customer = rows[0];

        if (!customer.pin_hash) {
            return res.status(401).json({
                success: false,
                message: 'PIN has not been configured for this account.'
            });
        }

        const pinMatches = await bcrypt.compare(
            String(pin),
            customer.pin_hash
        );

        if (!pinMatches) {
            return res.status(401).json({
                success: false,
                message: 'Incorrect PIN.'
            });
        }

        const token = jwt.sign(
            {
                phone_number: customer.phone_number,
                purpose: 'momo_ussd'
            },
            JWT_SECRET,
            { expiresIn: '5m' }
        );

        return res.json({
            success: true,
            message: 'PIN verified successfully.',
            token,
            customer: {
                phone_number: customer.phone_number,
                fullname: customer.fullname
            }
        });

    } catch (error) {
        console.error('MoMo PIN verification error:', error);

        return res.status(500).json({
            success: false,
            message: 'Unable to verify PIN.'
        });
    }
});

// Protect MoMo account endpoints
function authenticateMomo(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            success: false,
            message: 'Authentication token required.'
        });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        if (decoded.purpose !== 'momo_ussd') {
            return res.status(403).json({
                success: false,
                message: 'Invalid token purpose.'
            });
        }

        req.momoCustomer = decoded;
        next();

    } catch (error) {
        return res.status(401).json({
            success: false,
            message: 'Session expired. Please enter your PIN again.'
        });
    }
}

// Get authenticated customer's balance
router.get('/balance', authenticateMomo, async (req, res) => {
    try {
        const phone = req.momoCustomer.phone_number;

        const [rows] = await db.query(
            `SELECT phone_number, fullname, balance, activity
             FROM momo_active_users
             WHERE phone_number = ?
             LIMIT 1`,
            [phone]
        );

        if (rows.length === 0 || rows[0].activity !== 'ACTIVE') {
            return res.status(404).json({
                success: false,
                message: 'Active MoMo account not found.'
            });
        }

        return res.json({
            success: true,
            customer: {
                phone_number: rows[0].phone_number,
                fullname: rows[0].fullname,
                balance: Number(rows[0].balance)
            }
        });

    } catch (error) {
        console.error('MoMo balance error:', error);

        return res.status(500).json({
            success: false,
            message: 'Unable to retrieve account balance.'
        });
    }
});

module.exports = router;
