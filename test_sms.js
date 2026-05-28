require('dotenv').config();
const { sendSMSWithDetails } = require('./messaging');

async function main() {
    const phoneNumber = process.argv[2];
    const message = process.argv.slice(3).join(' ').trim();

    if (!phoneNumber || !message) {
        console.error('Usage: node test_sms.js <phone_number> "<message>"');
        console.error('Example: node test_sms.js 0241234567 "Test message from Lucky Susu"');
        process.exit(1);
    }

    const result = await sendSMSWithDetails(phoneNumber, message);
    console.log(JSON.stringify(result, null, 2));

    if (!result.success) {
        process.exit(1);
    }
}

main().catch((error) => {
    console.error('SMS test script failed:', error.message);
    process.exit(1);
});
