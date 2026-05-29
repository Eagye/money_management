/**
 * Remove all admin users and create a single admin from environment variables.
 *
 * Required: ADMIN_EMAIL, ADMIN_PASSWORD (recommended)
 * Railway alternative: set BOOTSTRAP_ADMIN=true and redeploy (no SSH needed).
 */
require('dotenv').config();
const { initDatabase } = require('./database');
const { resetAndCreateAdmin } = require('./admin_bootstrap');

async function main() {
    await initDatabase();
    const result = await resetAndCreateAdmin();

    console.log(`Removed ${result.removedAdmins} admin account(s).`);
    console.log('\n✅ New admin created successfully!');
    console.log('\n📋 Admin credentials (save these now):');
    console.log('   Email:   ', result.email);
    console.log('   Password:', result.password);
    console.log('   User ID: ', result.admin.id);
    console.log('\nRailway without SSH: set BOOTSTRAP_ADMIN=true, redeploy once, then remove it.\n');

    process.exit(0);
}

main().catch((error) => {
    console.error('❌ Error creating admin:', error.message);
    process.exit(1);
});
