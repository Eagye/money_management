// Script to clear rate limits (useful for testing)
const { clearRateLimit } = require('./rateLimiter');

console.log('🧹 Clearing all rate limits...');
clearRateLimit(); // Clear all
console.log('✅ Rate limits cleared!');
console.log('   You can now try logging in again.');
console.log('   Note: Rate limits will accumulate again with new requests.');

process.exit(0);

