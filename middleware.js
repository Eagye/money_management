// Middleware utilities for the application

const logger = require('./logger');

/**
 * Security headers middleware
 * Adds important security headers to all responses
 */
function securityHeaders(req, res, next) {
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    
    // Enable XSS protection
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Strict Transport Security (only if HTTPS)
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    
    // Permissions Policy (formerly Feature Policy)
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    
    next();
}

/**
 * Request logging middleware
 * Logs all incoming requests with timing
 */
function requestLogger(req, res, next) {
    const startTime = Date.now();
    
    // Log response when finished
    res.on('finish', () => {
        const responseTime = Date.now() - startTime;
        logger.logRequest(req, res, responseTime);
    });
    
    next();
}

/**
 * Error handler middleware
 * Centralized error handling
 */
function errorHandler(err, req, res, next) {
    // Log the error
    logger.error('Unhandled error', {
        error: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        ip: req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown'
    });
    
    // Don't expose internal error details in production
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const errorMessage = isDevelopment ? err.message : 'Internal server error';
    
    if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            success: false,
            error: errorMessage
        }));
    }
}

module.exports = {
    securityHeaders,
    requestLogger,
    errorHandler
};

