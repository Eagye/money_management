/**
 * Clear all app data except the admin user identified by ADMIN_EMAIL.
 * Preserves the admin's existing password (does not reset it).
 */
require('dotenv').config();
const { initDatabase, getDatabase } = require('./database');

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@luckysusu.com').toLowerCase();

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

async function clearAllExceptAdmin() {
    await initDatabase();
    const db = getDatabase();

    let admin = await get(
        db,
        `SELECT id, email, name FROM users WHERE LOWER(email) = ? LIMIT 1`,
        [ADMIN_EMAIL]
    );

    if (!admin) {
        admin = await get(
            db,
            `SELECT id, email, name FROM users
             WHERE is_admin = 1 AND created_by_admin = 1
             ORDER BY id ASC
             LIMIT 1`
        );
        if (admin) {
            console.warn(
                `No user for ADMIN_EMAIL=${ADMIN_EMAIL}; keeping primary admin ${admin.email} instead.`
            );
            console.warn(`Update ADMIN_EMAIL in .env to match, or create admin with that email.\n`);
        }
    }

    if (!admin) {
        console.error(`Admin not found for ADMIN_EMAIL=${ADMIN_EMAIL}`);
        console.error('Create the admin first (e.g. node create_admin.js) then run this script again.');
        process.exit(1);
    }

    console.log(`Keeping admin: ${admin.email} (id ${admin.id}) — password unchanged.\n`);

    await new Promise((resolve, reject) => {
        db.serialize(async () => {
            try {
                await run(db, 'BEGIN TRANSACTION');

                const tables = [
                    ['messages', 'DELETE FROM messages'],
                    ['transactions', 'DELETE FROM transactions'],
                    ['commission_cycles', 'DELETE FROM commission_cycles'],
                    ['agent_daily_status', 'DELETE FROM agent_daily_status'],
                    ['clients', 'DELETE FROM clients']
                ];

                for (const [label, sql] of tables) {
                    const result = await run(db, sql);
                    console.log(`✓ Cleared ${label} (${result.changes} rows)`);
                }

                const usersResult = await run(db, 'DELETE FROM users WHERE id != ?', [admin.id]);
                console.log(`✓ Removed non-admin users (${usersResult.changes} rows)`);

                await run(db, 'COMMIT');
                console.log('\n✅ Database cleared. Only admin account remains.');
                resolve();
            } catch (err) {
                await run(db, 'ROLLBACK').catch(() => {});
                reject(err);
            }
        });
    });
}

clearAllExceptAdmin()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('❌ Cleanup failed:', err.message);
        process.exit(1);
    });
