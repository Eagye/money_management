// Script to create an admin user
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

async function createAdmin() {
    try {
        // Initialize database
        await initDatabase();
        
        // Import database functions
        const { User } = require('./database');
        
        // Check if admin already exists
        const existingAdmin = await User.getByEmail(ADMIN_EMAIL);
        if (existingAdmin) {
            console.log('⚠️  Admin user already exists with email:', ADMIN_EMAIL);
            console.log('   Updating admin account with correct flags and password...');
            
            // Update existing admin with correct flags and password
            const sqlite3 = require('sqlite3').verbose();
            const path = require('path');
            const DB_PATH = path.join(__dirname, 'lucky_susu.db');
            const hashedPassword = await hashPassword(ADMIN_PASSWORD);
            
            await new Promise((resolve, reject) => {
                const db = new sqlite3.Database(DB_PATH, (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    
                    db.run(
                        `UPDATE users 
                         SET password = ?, 
                             is_admin = 1, 
                             is_approved = 1, 
                             created_by_admin = 1,
                             name = ?
                         WHERE email = ?`,
                        [hashedPassword, ADMIN_NAME, ADMIN_EMAIL.toLowerCase()],
                        function(err) {
                            db.close();
                            if (err) {
                                reject(err);
                            } else {
                                resolve();
                            }
                        }
                    );
                });
            });
            
            console.log('\n✅ Admin account updated successfully!');
            console.log('\n📋 Admin Credentials:');
            console.log('   Email:', ADMIN_EMAIL);
            console.log('   Password:', ADMIN_PASSWORD);
            console.log('   Name:', ADMIN_NAME);
            console.log('\n⚠️  IMPORTANT: Save these credentials securely!');
            console.log('   You can now login at: http://localhost:3000/index.html');
            console.log('   Then navigate to: http://localhost:3000/admin/dashboard.html\n');
            process.exit(0);
            return;
        }
        
        // Hash the password
        console.log('🔐 Hashing password...');
        const hashedPassword = await hashPassword(ADMIN_PASSWORD);
        
        // Create admin user with admin flags
        console.log('👤 Creating admin user...');
        const adminData = {
            name: ADMIN_NAME,
            email: ADMIN_EMAIL.toLowerCase(),
            password: hashedPassword,
            contact: ADMIN_CONTACT,
            validation_card_number: ADMIN_VALIDATION_CARD,
            guarantor_number: ADMIN_GUARANTOR_NUMBER,
            guarantor_validation_number: ADMIN_GUARANTOR_VALIDATION,
            is_admin: true,
            is_approved: true,
            created_by_admin: true  // Set to true for the initial admin account
        };
        
        const admin = await User.create(adminData);
        
        console.log('\n✅ Admin user created successfully!');
        console.log('\n📋 Admin Credentials:');
        console.log('   Email:', ADMIN_EMAIL);
        console.log('   Password:', ADMIN_PASSWORD);
        console.log('   Name:', ADMIN_NAME);
        console.log('\n⚠️  IMPORTANT: Save these credentials securely!');
        console.log('   You can now login at: http://localhost:3000/index.html');
        console.log('   Then navigate to: http://localhost:3000/admin/dashboard.html\n');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error creating admin user:', error);
        process.exit(1);
    }
}

// Run the script
createAdmin();

