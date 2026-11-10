
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

require('dotenv').config();

const db = require('./config/db');

const app = express();

// Middleware
app.use(helmet());

// Allow requests from the React + Vite frontend
app.use(cors({
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Routes
const momoRoutes = require('./routes/momoRoutes');
const authRoutes = require('./routes/authRoutes');
const accountRoutes = require('./routes/accountRoutes');
const ewalletRoutes = require('./routes/ewalletRoutes');
const ewalletTransferRoutes = require('./routes/ewalletTransferRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/ewallet', ewalletRoutes);
app.use('/api/ewallet', ewalletTransferRoutes);
app.use('/api/momo', momoRoutes);

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
