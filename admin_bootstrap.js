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

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(row);
        });
    });
}

function getAdminEnv() {
    return {
        email: (process.env.ADMIN_EMAIL || '').toLowerCase().trim(),
        password: process.env.ADMIN_PASSWORD || '',
        name: process.env.ADMIN_NAME || 'System Administrator',
        contact: process.env.ADMIN_CONTACT || '0240000000',
        validationCard: process.env.ADMIN_VALIDATION_CARD || 'GHA-000000000-0',
        guarantorNumber: process.env.ADMIN_GUARANTOR_NUMBER || '0240000001',
        guarantorValidation: process.env.ADMIN_GUARANTOR_VALIDATION || 'GHA-000000001-0'
    };
}

/**
 * Delete all admin users and create one admin from ADMIN_* env vars.
 */
async function resetAndCreateAdmin() {
    const env = getAdminEnv();
    if (!env.email) {
        throw new Error('ADMIN_EMAIL is required');
    }
    if (!env.password) {
        throw new Error('ADMIN_PASSWORD is required');
    }

    const db = getDatabase();

    const removedAdmins = await run(db, 'DELETE FROM users WHERE is_admin = 1');
    await run(db, 'DELETE FROM users WHERE LOWER(email) = ?', [env.email]);

    const hashedPassword = await hashPassword(env.password);

    const admin = await User.create({
        name: env.name,
        email: env.email,
        password: hashedPassword,
        contact: env.contact.replace(/\D/g, ''),
        validation_card_number: env.validationCard.trim().toUpperCase(),
        guarantor_number: env.guarantorNumber.replace(/\D/g, ''),
        guarantor_validation_number: env.guarantorValidation.trim().toUpperCase(),
        is_admin: true,
        is_approved: true,
        created_by_admin: true
    });

    return {
        admin,
        email: env.email,
        password: env.password,
        removedAdmins: removedAdmins.changes
    };
}

/**
 * Create admin only when database has no admin yet.
 */
async function createAdminIfMissing() {
    const env = getAdminEnv();
    if (!env.email || !env.password) {
        return null;
    }

    const db = getDatabase();
    const existingAdmin = await get(db, 'SELECT id FROM users WHERE is_admin = 1 LIMIT 1');
    if (existingAdmin) {
        return null;
    }

    const existingEmail = await User.getByEmail(env.email);
    if (existingEmail) {
        await run(
            db,
            `UPDATE users
             SET is_admin = 1, is_approved = 1, created_by_admin = 1, password = ?
             WHERE id = ?`,
            [await hashPassword(env.password), existingEmail.id]
        );
        logger.info('Promoted existing user to admin and reset password', { email: env.email });
        return { email: env.email, userId: existingEmail.id, promoted: true };
    }

    const hashedPassword = await hashPassword(env.password);
    const admin = await User.create({
        name: env.name,
        email: env.email,
        password: hashedPassword,
        contact: env.contact.replace(/\D/g, ''),
        validation_card_number: env.validationCard.trim().toUpperCase(),
        guarantor_number: env.guarantorNumber.replace(/\D/g, ''),
        guarantor_validation_number: env.guarantorValidation.trim().toUpperCase(),
        is_admin: true,
        is_approved: true,
        created_by_admin: true
    });

    logger.info('Created initial admin (database had no admin)', {
        email: env.email,
        userId: admin.id
    });

    return { email: env.email, userId: admin.id, created: true };
}

/**
 * On startup: reset admin if BOOTSTRAP_ADMIN=true, else create admin when none exists.
 */
async function ensureAdminAccount() {
    const env = getAdminEnv();

    if (process.env.BOOTSTRAP_ADMIN === 'true') {
        if (!env.email || !env.password) {
            logger.error('BOOTSTRAP_ADMIN is true but ADMIN_EMAIL or ADMIN_PASSWORD is missing');
            return;
        }

        const result = await resetAndCreateAdmin();
        logger.info('Admin reset via BOOTSTRAP_ADMIN', {
            email: result.email,
            userId: result.admin.id,
            removedAdmins: result.removedAdmins
        });
        logger.warn('Set BOOTSTRAP_ADMIN=false after you confirm login works');
        return;
    }

    if (!env.email || !env.password) {
        logger.warn('ADMIN_EMAIL or ADMIN_PASSWORD not set; admin auto-create skipped');
        return;
    }

    await createAdminIfMissing();
}

module.exports = {
    resetAndCreateAdmin,
    createAdminIfMissing,
    ensureAdminAccount,
    bootstrapAdminIfRequested: ensureAdminAccount
};
