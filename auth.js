const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { User } = require('./database');

// Load environment variables
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// Generate JWT token
function generateToken(user) {
    return jwt.sign(
        { 
            id: user.id, 
            email: user.email 
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
}

// Verify JWT token
function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return null;
    }
}

// Hash password with bcrypt
async function hashPassword(password) {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
}

// Compare password with hash
async function comparePassword(password, hash) {
    return await bcrypt.compare(password, hash);
}

// Authentication middleware for API routes
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        res.writeHead(401);
        res.end(JSON.stringify({ success: false, error: 'Authentication required' }));
        return;
    }

    const decoded = verifyToken(token);
    if (!decoded) {
        res.writeHead(403);
        res.end(JSON.stringify({ success: false, error: 'Invalid or expired token' }));
        return;
    }

    // Attach user info to request
    req.user = decoded;
    next();
}

// Optional: Get user from token (for optional auth)
function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
        const decoded = verifyToken(token);
        if (decoded) {
            req.user = decoded;
        }
    }
    next();
}

module.exports = {
    generateToken,
    verifyToken,
    hashPassword,
    comparePassword,
    authenticateToken,
    optionalAuth
};

