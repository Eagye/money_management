// Configuration validation and management

const logger = require('./logger');

/**
 * Validates required environment variables
 * Throws error if validation fails
 */
function validateConfig() {
    const errors = [];
    const warnings = [];
    
    // Required variables
    const required = {
        JWT_SECRET: {
            value: process.env.JWT_SECRET,
            message: 'JWT_SECRET is required for authentication',
            minLength: 32,
            recommendation: 'Use a strong random string (minimum 32 characters)'
        }
    };
    
    // Optional but recommended variables
    const recommended = {
        PORT: {
            value: process.env.PORT,
            default: '3000',
            message: 'PORT not set, using default 3000'
        },
        NODE_ENV: {
            value: process.env.NODE_ENV,
            default: 'development',
            message: 'NODE_ENV not set, using default "development"'
        },
        LOG_LEVEL: {
            value: process.env.LOG_LEVEL,
            default: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
            message: 'LOG_LEVEL not set, using default'
        }
    };
    
    // Validate required variables
    for (const [key, config] of Object.entries(required)) {
        if (!config.value) {
            // In development, allow fallback values
            if (key === 'JWT_SECRET' && process.env.NODE_ENV !== 'production') {
                // Use fallback for development (same as auth.js)
                process.env.JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key-change-in-production';
                warnings.push({
                    variable: key,
                    message: `${key} not set, using fallback value (NOT SECURE FOR PRODUCTION)`,
                    recommendation: config.recommendation
                });
            } else {
                errors.push({
                    variable: key,
                    message: config.message,
                    recommendation: config.recommendation
                });
            }
        } else if (config.minLength && config.value.length < config.minLength) {
            // Only enforce min length in production
            if (process.env.NODE_ENV === 'production') {
                errors.push({
                    variable: key,
                    message: `${key} must be at least ${config.minLength} characters long`,
                    recommendation: config.recommendation
                });
            } else {
                warnings.push({
                    variable: key,
                    message: `${key} is shorter than recommended (${config.minLength} chars)`,
                    recommendation: config.recommendation
                });
            }
        }
    }
    
    // Warn about recommended variables
    for (const [key, config] of Object.entries(recommended)) {
        if (!config.value) {
            warnings.push({
                variable: key,
                message: config.message,
                default: config.default
            });
            // Set default value
            process.env[key] = config.default;
        }
    }
    
    // Check for weak JWT_SECRET in production
    if (process.env.NODE_ENV === 'production' && process.env.JWT_SECRET) {
        if (process.env.JWT_SECRET.length < 32) {
            errors.push({
                variable: 'JWT_SECRET',
                message: 'JWT_SECRET is too short for production (minimum 32 characters)',
                recommendation: 'Generate a strong random secret: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
            });
        }
        if (process.env.JWT_SECRET === 'fallback-secret-key-change-in-production') {
            errors.push({
                variable: 'JWT_SECRET',
                message: 'JWT_SECRET is using the default fallback value',
                recommendation: 'Change JWT_SECRET to a strong random string in production'
            });
        }
    }
    
    // Log warnings
    if (warnings.length > 0) {
        logger.warn('Configuration warnings', { warnings });
        warnings.forEach(w => {
            logger.warn(`${w.variable}: ${w.message} (using default: ${w.default})`);
        });
    }
    
    // Throw error if validation fails
    if (errors.length > 0) {
        logger.error('Configuration validation failed', { errors });
        const errorMessages = errors.map(e => 
            `  - ${e.variable}: ${e.message}\n    Recommendation: ${e.recommendation || 'N/A'}`
        ).join('\n');
        
        throw new Error(
            `Configuration validation failed:\n${errorMessages}\n\n` +
            'Please check your .env file and ensure all required variables are set correctly.'
        );
    }
    
    logger.info('Configuration validated successfully');
}

/**
 * Get configuration object
 */
function getConfig() {
    return {
        port: parseInt(process.env.PORT) || 3000,
        nodeEnv: process.env.NODE_ENV || 'development',
        logLevel: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
        jwtSecret: process.env.JWT_SECRET,
        jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
        adminEmail: (process.env.ADMIN_EMAIL || 'admin@luckysusu.com').toLowerCase(),
        allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(','),
        rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
        rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
    };
}

module.exports = {
    validateConfig,
    getConfig
};

