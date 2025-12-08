// Simple in-memory rate limiter
const rateLimitMap = new Map();

function getClientIp(req) {
    return req.headers['x-forwarded-for'] || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress ||
           'unknown';
}

function buildRateLimitKey(ip, bucket) {
    return `${bucket || 'default'}:${ip}`;
}

function checkRateLimit(req, res, windowMs, maxRequests, bucket = 'default') {
    const ip = getClientIp(req);
    const key = buildRateLimitKey(ip, bucket);
    
    const now = Date.now();
    const windowStart = now - windowMs;
    
    // Clean old entries
    if (rateLimitMap.has(key)) {
        const requests = rateLimitMap.get(key);
        const filtered = requests.filter(time => time > windowStart);
        rateLimitMap.set(key, filtered);
        
        if (filtered.length >= maxRequests) {
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
                success: false, 
                error: `Too many requests. Please try again in ${Math.ceil((windowMs - (now - (filtered[0] || now))) / 1000)} seconds.` 
            }));
            return false; // Rate limit exceeded
        }
        
        filtered.push(now);
        rateLimitMap.set(key, filtered);
    } else {
        rateLimitMap.set(key, [now]);
    }
    
    return true; // Rate limit OK
}

// Function to clear rate limit for a specific IP (useful for testing)
function clearRateLimit(ip, bucket) {
    if (ip) {
        if (bucket) {
            rateLimitMap.delete(buildRateLimitKey(ip, bucket));
            return;
        }
        // Remove all buckets for this IP
        for (const mapKey of rateLimitMap.keys()) {
            if (mapKey.endsWith(`:${ip}`) || mapKey === ip) {
                rateLimitMap.delete(mapKey);
            }
        }
    } else {
        // Clear all rate limits
        rateLimitMap.clear();
    }
}

function createRateLimiter(windowMs, maxRequests, bucket = 'default') {
    return (req, res, next) => {
        if (!checkRateLimit(req, res, windowMs, maxRequests, bucket)) {
            return; // Request blocked
        }
        next();
    };
}

// Clean up old entries periodically
setInterval(() => {
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 minutes
    const windowStart = now - windowMs;
    
    for (const [key, requests] of rateLimitMap.entries()) {
        const filtered = requests.filter(time => time > windowStart);
        if (filtered.length === 0) {
            rateLimitMap.delete(key);
        } else {
            rateLimitMap.set(key, filtered);
        }
    }
}, 5 * 60 * 1000); // Clean every 5 minutes

module.exports = { createRateLimiter, checkRateLimit, clearRateLimit };

