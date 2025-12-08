/**
 * Migration Script: Initialize Commission Cycles for Existing Clients
 * 
 * This script calculates cumulative withdrawals from transaction history
 * and initializes commission cycles for existing clients who had withdrawals
 * before the commission cycle system was implemented.
 * 
 * Usage: node migrate-commission-cycles.js
 */

const { initDatabase, Client, Transaction, CommissionCycle } = require('./database');

async function migrateCommissionCycles() {
    console.log('🔄 Starting Commission Cycle Migration...\n');

    try {
        // Initialize database
        await initDatabase();
        console.log('✅ Database initialized\n');

        // Get all clients
        const clients = await Client.getAllForAdmin();
        console.log(`📊 Found ${clients.length} client(s) to process\n`);

        let migrated = 0;
        let skipped = 0;
        let errors = 0;

        for (const client of clients) {
            try {
                const clientId = client.id;
                const clientRate = parseFloat(client.rate || 0);

                // Get all withdrawal transactions for this client
                const transactions = await Transaction.getByClientId(clientId, client.agent_id, 1, 1000);
                const withdrawalTransactions = (transactions.data || []).filter(
                    t => t.transaction_type === 'withdrawal'
                );

                if (withdrawalTransactions.length === 0) {
                    console.log(`⏭️  Skipping ${client.name} (ID: ${clientId}) - No withdrawals found`);
                    skipped++;
                    continue;
                }

                // Calculate cumulative withdrawal amount
                let cumulative = 0;
                let lastCommissionDate = null;

                // Sort by date to process chronologically
                withdrawalTransactions.sort((a, b) => {
                    return new Date(a.transaction_date) - new Date(b.transaction_date);
                });

                for (const withdrawal of withdrawalTransactions) {
                    const withdrawalAmount = Math.abs(parseFloat(withdrawal.amount || 0));
                    cumulative += withdrawalAmount;

                    // Check if there was a commission transaction for this withdrawal
                    const commissionTransactions = await new Promise((resolve, reject) => {
                        const db = require('./database').getDatabase();
                        db.all(
                            `SELECT * FROM transactions 
                             WHERE related_transaction_id = ? AND transaction_type = 'commission'`,
                            [withdrawal.id],
                            (err, rows) => {
                                if (err) reject(err);
                                else resolve(rows || []);
                            }
                        );
                    });

                    if (commissionTransactions.length > 0) {
                        // Commission was deducted, reset cumulative
                        // The commission amount equals the client rate
                        cumulative = Math.max(0, cumulative - clientRate);
                        lastCommissionDate = withdrawal.transaction_date;
                    }
                }

                // If cumulative exceeds rate, it means we're in a partial cycle
                // Adjust to be within the rate range
                if (cumulative >= clientRate) {
                    cumulative = cumulative % clientRate;
                }

                // Initialize or update commission cycle
                await CommissionCycle.adjust(clientId, cumulative);

                console.log(`✅ Migrated ${client.name} (ID: ${clientId})`);
                console.log(`   - Cumulative: ${cumulative.toFixed(2)} / ${clientRate.toFixed(2)}`);
                console.log(`   - Withdrawals processed: ${withdrawalTransactions.length}`);
                console.log('');

                migrated++;

            } catch (error) {
                console.error(`❌ Error processing ${client.name} (ID: ${client.id}):`, error.message);
                errors++;
            }
        }

        console.log('\n📈 Migration Summary:');
        console.log(`   ✅ Migrated: ${migrated}`);
        console.log(`   ⏭️  Skipped: ${skipped}`);
        console.log(`   ❌ Errors: ${errors}`);
        console.log('\n✨ Migration completed!');

    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    }
}

// Run migration
if (require.main === module) {
    migrateCommissionCycles()
        .then(() => {
            console.log('\n✅ Migration script completed successfully');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n❌ Migration script failed:', error);
            process.exit(1);
        });
}

module.exports = { migrateCommissionCycles };

