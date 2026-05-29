const crypto = require('crypto');
const { getDatabase, User } = require('./database');
const { hashPassword } = require('./auth');
const logger = require('./logger');

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

/**
 * Delete all admin users and create one admin from ADMIN_* env vars.
 */
async function resetAndCreateAdmin() {
    const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
    const adminPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url');
    const adminName = process.env.ADMIN_NAME || 'System Administrator';
    const adminContact = process.env.ADMIN_CONTACT || '0240000000';
    const adminValidationCard = process.env.ADMIN_VALIDATION_CARD || 'GHA-000000000-0';
    const adminGuarantorNumber = process.env.ADMIN_GUARANTOR_NUMBER || '0240000001';
    const adminGuarantorValidation = process.env.ADMIN_GUARANTOR_VALIDATION || 'GHA-000000001-0';

    if (!adminEmail) {
        throw new Error('ADMIN_EMAIL is required');
    }

    const db = getDatabase();

    const removedAdmins = await run(db, 'DELETE FROM users WHERE is_admin = 1');
    await run(db, 'DELETE FROM users WHERE LOWER(email) = ?', [adminEmail]);

    const hashedPassword = await hashPassword(adminPassword);

    const admin = await User.create({
        name: adminName,
        email: adminEmail,
        password: hashedPassword,
        contact: adminContact.replace(/\D/g, ''),
        validation_card_number: adminValidationCard.trim().toUpperCase(),
        guarantor_number: adminGuarantorNumber.replace(/\D/g, ''),
        guarantor_validation_number: adminGuarantorValidation.trim().toUpperCase(),
        is_admin: true,
        is_approved: true,
        created_by_admin: true
    });

    return {
        admin,
        email: adminEmail,
        password: adminPassword,
        removedAdmins: removedAdmins.changes
    };
}

/**
 * Run admin reset on server startup when BOOTSTRAP_ADMIN=true (one-time Railway setup).
 */
async function bootstrapAdminIfRequested() {
    if (process.env.BOOTSTRAP_ADMIN !== 'true') {
        return;
    }

    if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
        logger.error('BOOTSTRAP_ADMIN is true but ADMIN_EMAIL or ADMIN_PASSWORD is missing');
        return;
    }

    const result = await resetAndCreateAdmin();
    logger.info('Admin bootstrap completed', {
        email: result.email,
        userId: result.admin.id,
        removedAdmins: result.removedAdmins
    });
    logger.warn('Remove BOOTSTRAP_ADMIN from environment after first successful deploy');
}

module.exports = {
    resetAndCreateAdmin,
    bootstrapAdminIfRequested
};
