const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Define log format
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

// Console format for development (more readable)
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        let msg = `${timestamp} [${level}]: ${message}`;
        if (Object.keys(meta).length > 0 && meta.stack) {
            msg += `\n${meta.stack}`;
        } else if (Object.keys(meta).length > 0) {
            msg += ` ${JSON.stringify(meta)}`;
        }
        return msg;
    })
);

// Sanitize sensitive data from logs
function sanitizeData(data) {
    if (!data || typeof data !== 'object') {
        return data;
    }
    
    const sensitiveKeys = ['password', 'token', 'authorization', 'secret', 'api_key', 'apikey'];
    const sanitized = { ...data };
    
    for (const key in sanitized) {
        const lowerKey = key.toLowerCase();
        if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
            sanitized[key] = '***REDACTED***';
        } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
            sanitized[key] = sanitizeData(sanitized[key]);
        }
    }
    
    return sanitized;
}

// Create logger instance
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    format: logFormat,
    defaultMeta: { service: 'lucky-susu' },
    transports: [
        // Write all logs to combined.log
        new winston.transports.File({
            filename: path.join(logsDir, 'combined.log'),
            maxsize: 10485760, // 10MB
            maxFiles: 5,
            tailable: true
        }),
        // Write errors to error.log
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            maxsize: 10485760, // 10MB
            maxFiles: 5,
            tailable: true
        })
    ],
    // Don't exit on handled exceptions
    exitOnError: false
});

// Add console transport for development
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: consoleFormat
    }));
}

// Custom logging methods with sanitization
const originalLog = logger.log.bind(logger);
logger.log = function(level, message, meta = {}) {
    const sanitizedMeta = sanitizeData(meta);
    return originalLog(level, message, sanitizedMeta);
};

// Helper methods
logger.info = function(message, meta = {}) {
    return this.log('info', message, sanitizeData(meta));
};

logger.error = function(message, meta = {}) {
    return this.log('error', message, sanitizeData(meta));
};

logger.warn = function(message, meta = {}) {
    return this.log('warn', message, sanitizeData(meta));
};

logger.debug = function(message, meta = {}) {
    return this.log('debug', message, sanitizeData(meta));
};

// Request logging helper
logger.logRequest = function(req, res, responseTime) {
    const logData = {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        responseTime: `${responseTime}ms`,
        ip: req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent']
    };
    
    // Add user info if available
    if (req.user) {
        logData.userId = req.user.id;
        logData.userEmail = req.user.email;
    }
    
    if (res.statusCode >= 500) {
        this.error('Request error', logData);
    } else if (res.statusCode >= 400) {
        this.warn('Request warning', logData);
    } else {
        this.info('Request completed', logData);
    }
};

module.exports = logger;

