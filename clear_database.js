// Script to clear all database data except admin account
require('dotenv').config();
const { initDatabase } = require('./database');
const { hashPassword } = require('./auth');

const ADMIN_EMAIL = 'admin@luckysusu.com';
const ADMIN_PASSWORD = 'Admin@123';
const ADMIN_NAME = 'System Administrator';
const ADMIN_CONTACT = '0240000000';
const ADMIN_VALIDATION_CARD = 'GHA-000000000-0';
const ADMIN_GUARANTOR_NUMBER = '0240000001';
const ADMIN_GUARANTOR_VALIDATION = 'GHA-000000001-0';

async function clearDatabase() {
    try {
        // Initialize database
        await initDatabase();
        
        const sqlite3 = require('sqlite3').verbose();
        const path = require('path');
        const DB_PATH = path.join(__dirname, 'lucky_susu.db');
        
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(DB_PATH, (err) => {
                if (err) {
                    console.error('Error opening database:', err);
                    reject(err);
                    return;
                }
                
                console.log('Connected to SQLite database');
                console.log('Starting database cleanup...\n');
                
                // Begin transaction
                db.serialize(() => {
                    db.run('BEGIN TRANSACTION');
                    
                    // Delete all data from tables (in correct order due to foreign keys)
                    console.log('Deleting all transactions...');
                    db.run('DELETE FROM transactions', (err) => {
                        if (err) {
                            console.error('Error deleting transactions:', err);
                            db.run('ROLLBACK');
                            reject(err);
                            return;
                        }
                        console.log('✓ Transactions deleted');
                    });
                    
                    console.log('Deleting all commission cycles...');
                    db.run('DELETE FROM commission_cycles', (err) => {
                        if (err) {
                            console.error('Error deleting commission cycles:', err);
                            db.run('ROLLBACK');
                            reject(err);
                            return;
                        }
                        console.log('✓ Commission cycles deleted');
                    });
                    
                    console.log('Deleting all agent daily status records...');
                    db.run('DELETE FROM agent_daily_status', (err) => {
                        if (err) {
                            console.error('Error deleting agent daily status:', err);
                            db.run('ROLLBACK');
                            reject(err);
                            return;
                        }
                        console.log('✓ Agent daily status deleted');
                    });
                    
                    console.log('Deleting all clients...');
                    db.run('DELETE FROM clients', (err) => {
                        if (err) {
                            console.error('Error deleting clients:', err);
                            db.run('ROLLBACK');
                            reject(err);
                            return;
                        }
                        console.log('✓ Clients deleted');
                    });
                    
                    console.log('Deleting all users except admin...');
                    db.run('DELETE FROM users WHERE email != ?', [ADMIN_EMAIL.toLowerCase()], async (err) => {
                        if (err) {
                            console.error('Error deleting users:', err);
                            db.run('ROLLBACK');
                            reject(err);
                            return;
                        }
                        console.log('✓ Non-admin users deleted');
                        
                        // Check if admin exists
                        db.get('SELECT * FROM users WHERE email = ?', [ADMIN_EMAIL.toLowerCase()], async (err, row) => {
                            if (err) {
                                console.error('Error checking admin user:', err);
                                db.run('ROLLBACK');
                                reject(err);
                                return;
                            }
                            
                            const hashedPassword = await hashPassword(ADMIN_PASSWORD);
                            
                            if (row) {
                                // Update existing admin
                                console.log('Updating admin account...');
                                db.run(
                                    `UPDATE users 
                                     SET password = ?, 
                                         name = ?,
                                         contact = ?,
                                         validation_card_number = ?,
                                         guarantor_number = ?,
                                         guarantor_validation_number = ?,
                                         is_admin = 1, 
                                         is_approved = 1, 
                                         created_by_admin = 1
                                     WHERE email = ?`,
                                    [
                                        hashedPassword,
                                        ADMIN_NAME,
                                        ADMIN_CONTACT,
                                        ADMIN_VALIDATION_CARD,
                                        ADMIN_GUARANTOR_NUMBER,
                                        ADMIN_GUARANTOR_VALIDATION,
                                        ADMIN_EMAIL.toLowerCase()
                                    ],
                                    function(updateErr) {
                                        if (updateErr) {
                                            console.error('Error updating admin:', updateErr);
                                            db.run('ROLLBACK');
                                            reject(updateErr);
                                            return;
                                        }
                                        console.log('✓ Admin account updated');
                                        commitTransaction(db, resolve, reject);
                                    }
                                );
                            } else {
                                // Create admin if it doesn't exist
                                console.log('Creating admin account...');
                                db.run(
                                    `INSERT INTO users 
                                     (name, email, password, contact, validation_card_number, 
                                      guarantor_number, guarantor_validation_number, 
                                      is_admin, is_approved, created_by_admin) 
                                     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 1)`,
                                    [
                                        ADMIN_NAME,
                                        ADMIN_EMAIL.toLowerCase(),
                                        hashedPassword,
                                        ADMIN_CONTACT,
                                        ADMIN_VALIDATION_CARD,
                                        ADMIN_GUARANTOR_NUMBER,
                                        ADMIN_GUARANTOR_VALIDATION
                                    ],
                                    function(insertErr) {
                                        if (insertErr) {
                                            console.error('Error creating admin:', insertErr);
                                            db.run('ROLLBACK');
                                            reject(insertErr);
                                            return;
                                        }
                                        console.log('✓ Admin account created');
                                        commitTransaction(db, resolve, reject);
                                    }
                                );
                            }
                        });
                    });
                });
            });
        });
    } catch (error) {
        console.error('❌ Error clearing database:', error);
        process.exit(1);
    }
}

function commitTransaction(db, resolve, reject) {
    db.run('COMMIT', (err) => {
        if (err) {
            console.error('Error committing transaction:', err);
            db.run('ROLLBACK');
            reject(err);
            return;
        }
        
        console.log('\n✅ Database cleared successfully!');
        console.log('\n📋 Admin Account:');
        console.log('   Email:', ADMIN_EMAIL);
        console.log('   Password:', ADMIN_PASSWORD);
        console.log('   Name:', ADMIN_NAME);
        console.log('\n⚠️  All other data has been removed from the database.');
        console.log('   You can now login at: http://localhost:3000/index.html\n');
        
        db.close((closeErr) => {
            if (closeErr) {
                console.error('Error closing database:', closeErr);
            }
            resolve();
            process.exit(0);
        });
    });
}

// Run the script
clearDatabase();

