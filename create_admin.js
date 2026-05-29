/**
 * Remove all admin users and create a single admin from environment variables.
 *
 * Required: ADMIN_EMAIL
 * Optional: ADMIN_PASSWORD (generated if omitted), ADMIN_NAME, ADMIN_CONTACT, etc.
 *
 * Railway: set ADMIN_EMAIL and ADMIN_PASSWORD in Variables, then run:
 *   node create_admin.js
 */
require('dotenv').config();
const crypto = require('crypto');
const { initDatabase, getDatabase, User } = require('./database');
const { hashPassword } = require('./auth');

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
const ADMIN_NAME = process.env.ADMIN_NAME || 'System Administrator';
const ADMIN_CONTACT = process.env.ADMIN_CONTACT || '0240000000';
const ADMIN_VALIDATION_CARD = process.env.ADMIN_VALIDATION_CARD || 'GHA-000000000-0';
const ADMIN_GUARANTOR_NUMBER = process.env.ADMIN_GUARANTOR_NUMBER || '0240000001';
const ADMIN_GUARANTOR_VALIDATION = process.env.ADMIN_GUARANTOR_VALIDATION || 'GHA-000000001-0';

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) {
                reject(err);
                return;
            }
            resolve({ changes: this.changes });
        });
    });
}

async function createAdmin() {
    if (!ADMIN_EMAIL) {
        console.error('ADMIN_EMAIL is required in .env or environment variables.');
        process.exit(1);
    }

    await initDatabase();
    const db = getDatabase();

    const removedAdmins = await run(db, 'DELETE FROM users WHERE is_admin = 1');
    const removedDuplicate = await run(db, 'DELETE FROM users WHERE LOWER(email) = ?', [ADMIN_EMAIL]);

    console.log(`Removed ${removedAdmins.changes} admin account(s).`);
    if (removedDuplicate.changes > 0) {
        console.log(`Removed existing user with email ${ADMIN_EMAIL} (if any).`);
    }

    const hashedPassword = await hashPassword(ADMIN_PASSWORD);

    const admin = await User.create({
        name: ADMIN_NAME,
        email: ADMIN_EMAIL,
        password: hashedPassword,
        contact: ADMIN_CONTACT.replace(/\D/g, ''),
        validation_card_number: ADMIN_VALIDATION_CARD.trim().toUpperCase(),
        guarantor_number: ADMIN_GUARANTOR_NUMBER.replace(/\D/g, ''),
        guarantor_validation_number: ADMIN_GUARANTOR_VALIDATION.trim().toUpperCase(),
        is_admin: true,
        is_approved: true,
        created_by_admin: true
    });

    console.log('\n✅ New admin created successfully!');
    console.log('\n📋 Admin credentials (save these now):');
    console.log('   Email:   ', ADMIN_EMAIL);
    console.log('   Password:', ADMIN_PASSWORD);
    console.log('   User ID: ', admin.id);
    console.log('\nOn Railway: set ADMIN_EMAIL and ADMIN_PASSWORD in Variables, redeploy, then run:');
    console.log('   node create_admin.js\n');

    process.exit(0);
}

createAdmin().catch((error) => {
    console.error('❌ Error creating admin:', error.message);
    process.exit(1);
});
