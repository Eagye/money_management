const { initDatabase, getDatabase } = require('./database');
const path = require('path');

async function clearAllExceptAdmin() {
    try {
        // Initialize database connection
        await initDatabase();
        const db = getDatabase();

        return new Promise((resolve, reject) => {
            db.serialize(() => {
                // Get admin email from environment or use default
                const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@luckysusu.com').toLowerCase();

                console.log(`Finding admin user with email: ${ADMIN_EMAIL}`);

                // First, get the admin user's data
                db.get(
                    `SELECT id, email, password, name, contact, validation_card_number, 
                     guarantor_number, guarantor_validation_number, is_admin, is_approved, 
                     is_rejected, created_by_admin, created_at, updated_at 
                     FROM users WHERE email = ? OR is_admin = 1 LIMIT 1`,
                    [ADMIN_EMAIL],
                    (err, adminUser) => {
                        if (err) {
                            console.error('Error finding admin user:', err);
                            reject(err);
                            return;
                        }

                        if (!adminUser) {
                            console.error('Admin user not found! Cannot proceed.');
                            reject(new Error('Admin user not found'));
                            return;
                        }

                        console.log(`Found admin user: ${adminUser.email} (ID: ${adminUser.id})`);

                        // Start transaction
                        db.run('BEGIN TRANSACTION', (beginErr) => {
                            if (beginErr) {
                                reject(beginErr);
                                return;
                            }

                            let completed = 0;
                            const totalOperations = 7;
                            let hasError = false;

                            const checkComplete = () => {
                                completed++;
                                if (completed === totalOperations) {
                                    if (hasError) {
                                        db.run('ROLLBACK', () => {
                                            reject(new Error('Error during cleanup'));
                                        });
                                    } else {
                                        // Delete all non-admin users
                                        db.run(
                                            `DELETE FROM users WHERE id != ?`,
                                            [adminUser.id],
                                            (userErr) => {
                                                if (userErr) {
                                                    console.error('Error deleting non-admin users:', userErr);
                                                    db.run('ROLLBACK', () => {
                                                        reject(userErr);
                                                    });
                                                    return;
                                                }

                                                // Reset auto-increment for users table (keep admin)
                                                db.run(
                                                    `UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM users) WHERE name = 'users'`,
                                                    (seqErr) => {
                                                        if (seqErr) {
                                                            console.warn('Warning: Could not reset sequence for users:', seqErr.message);
                                                        }
                                                    }
                                                );

                                                // Commit transaction
                                                db.run('COMMIT', (commitErr) => {
                                                    if (commitErr) {
                                                        reject(commitErr);
                                                    } else {
                                                        console.log('✅ Successfully cleared all data except admin user');
                                                        console.log(`Admin user preserved: ${adminUser.email}`);
                                                        resolve();
                                                    }
                                                });
                                            }
                                        );
                                    }
                                }
                            };

                            // Delete all messages
                            db.run('DELETE FROM messages', (err) => {
                                if (err) {
                                    console.error('Error deleting messages:', err);
                                    hasError = true;
                                } else {
                                    console.log('✓ Deleted all messages');
                                }
                                checkComplete();
                            });

                            // Delete all transactions
                            db.run('DELETE FROM transactions', (err) => {
                                if (err) {
                                    console.error('Error deleting transactions:', err);
                                    hasError = true;
                                } else {
                                    console.log('✓ Deleted all transactions');
                                }
                                checkComplete();
                            });

                            // Delete all clients
                            db.run('DELETE FROM clients', (err) => {
                                if (err) {
                                    console.error('Error deleting clients:', err);
                                    hasError = true;
                                } else {
                                    console.log('✓ Deleted all clients');
                                }
                                checkComplete();
                            });

                            // Delete all commission cycles
                            db.run('DELETE FROM commission_cycles', (err) => {
                                if (err) {
                                    console.error('Error deleting commission cycles:', err);
                                    hasError = true;
                                } else {
                                    console.log('✓ Deleted all commission cycles');
                                }
                                checkComplete();
                            });

                            // Delete all agent daily status
                            db.run('DELETE FROM agent_daily_status', (err) => {
                                if (err) {
                                    console.error('Error deleting agent daily status:', err);
                                    hasError = true;
                                } else {
                                    console.log('✓ Deleted all agent daily status');
                                }
                                checkComplete();
                            });

                            // Reset auto-increment sequences for other tables
                            const resetSequences = [
                                { table: 'messages', seq: 0 },
                                { table: 'transactions', seq: 0 },
                                { table: 'clients', seq: 0 },
                                { table: 'commission_cycles', seq: 0 }
                            ];

                            resetSequences.forEach(({ table, seq }) => {
                                db.run(
                                    `UPDATE sqlite_sequence SET seq = ? WHERE name = ?`,
                                    [seq, table],
                                    (seqErr) => {
                                        if (seqErr && !seqErr.message.includes('no such table')) {
                                            console.warn(`Warning: Could not reset sequence for ${table}:`, seqErr.message);
                                        }
                                        checkComplete();
                                    }
                                );
                            });
                        });
                    }
                );
            });
        });
    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
}

// Run the cleanup
clearAllExceptAdmin()
    .then(() => {
        console.log('\n🎉 Database cleanup completed successfully!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Error during cleanup:', error);
        process.exit(1);
    });

