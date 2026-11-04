const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

require('dotenv').config();

const db = require('./config/db');


const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Authentication routes
const authRoutes = require('./routes/authRoutes');
const accountRoutes = require('./routes/accountRoutes');
const ewalletRoutes = require('./routes/ewalletRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/ewallet', ewalletRoutes);

// Home route
app.get('/', (req, res) => {
    res.json({
        message: 'Banking API is running'
    });
});

// Database connection test
app.get('/api/test-db', async (req, res) => {

    try {

        await db.query('SELECT 1');

        res.json({
            success: true,
            message: 'MySQL connected successfully'
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: 'Database connection failed'
        });

    }

});

// Start server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Banking API running on port ${PORT}`);
});