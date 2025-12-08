const { initDatabase, getDatabase } = require('./database');

async function testCommissionLogic() {
    try {
        await initDatabase();
        const db = getDatabase();
        
        console.log('🧪 Testing Commission Logic for Yaw Manu\'s Scenario\n');
        console.log('='.repeat(80));
        
        // Get client
        db.get('SELECT * FROM clients WHERE id = 1', (err, client) => {
            if (err) {
                console.error('Error:', err);
                process.exit(1);
            }
            
            const clientRate = parseFloat(client.rate);
            const threshold = 31 * clientRate;
            
            console.log(`Client: ${client.name}`);
            console.log(`Rate: ₵${clientRate.toFixed(2)}`);
            console.log(`Commission Threshold: ₵${threshold.toFixed(2)}\n`);
            
            // Simulate the scenario
            console.log('📊 Simulating Yaw Manu\'s Withdrawals:\n');
            console.log('-'.repeat(80));
            
            let balance = 200;
            let cumulative = 0;
            
            console.log(`\nInitial Balance: ₵${balance.toFixed(2)}`);
            console.log(`Initial Cumulative: ₵${cumulative.toFixed(2)}\n`);
            
            // Withdrawal 1: ₵100
            console.log('📤 WITHDRAWAL #1: ₵100.00');
            const withdrawal1 = 100;
            const balanceAfter1 = balance - withdrawal1;
            const isFull1 = balanceAfter1 <= clientRate;
            
            console.log(`   Balance Before: ₵${balance.toFixed(2)}`);
            console.log(`   Balance After: ₵${balanceAfter1.toFixed(2)}`);
            console.log(`   Is Full Withdrawal? ${isFull1 ? 'YES' : 'NO'}`);
            
            if (isFull1) {
                console.log(`   ✅ Full withdrawal - Commission: ₵${clientRate.toFixed(2)} (from remaining balance)`);
                console.log(`   Client Gets: ₵${withdrawal1.toFixed(2)} (full withdrawal amount)`);
                console.log(`   Commission Deducted From: Remaining balance (₵${balanceAfter1.toFixed(2)})`);
                balance = balanceAfter1 - clientRate; // Commission from remaining balance
                cumulative = 0;
            } else {
                console.log(`   ℹ️  Normal withdrawal - No commission (page not complete)`);
                cumulative += withdrawal1;
                balance = balanceAfter1;
            }
            console.log(`   Final Balance: ₵${balance.toFixed(2)}`);
            console.log(`   Final Cumulative: ₵${cumulative.toFixed(2)}\n`);
            
            // Withdrawal 2: ₵50
            console.log('📤 WITHDRAWAL #2: ₵50.00');
            const withdrawal2 = 50;
            const balanceAfter2 = balance - withdrawal2;
            const isFull2 = balanceAfter2 <= clientRate;
            
            console.log(`   Balance Before: ₵${balance.toFixed(2)}`);
            console.log(`   Balance After: ₵${balanceAfter2.toFixed(2)}`);
            console.log(`   Is Full Withdrawal? ${isFull2 ? 'YES' : 'NO'}`);
            
            if (isFull2) {
                console.log(`   ✅ Full withdrawal - Commission: ₵${clientRate.toFixed(2)} (from remaining balance)`);
                console.log(`   Client Gets: ₵${withdrawal2.toFixed(2)} (full withdrawal amount)`);
                console.log(`   Commission Deducted From: Remaining balance (₵${balanceAfter2.toFixed(2)})`);
                balance = balanceAfter2 - clientRate; // Commission from remaining balance
                cumulative = 0;
            } else {
                console.log(`   ℹ️  Normal withdrawal - No commission (page not complete)`);
                cumulative += withdrawal2;
                balance = balanceAfter2;
            }
            console.log(`   Final Balance: ₵${balance.toFixed(2)}`);
            console.log(`   Final Cumulative: ₵${cumulative.toFixed(2)}\n`);
            
            console.log('='.repeat(80));
            console.log('\n📋 FINAL SUMMARY:');
            console.log('='.repeat(80));
            console.log(`Total Withdrawals: ₵${(withdrawal1 + withdrawal2).toFixed(2)}`);
            console.log(`  - Withdrawal 1: ₵${withdrawal1.toFixed(2)}`);
            console.log(`  - Withdrawal 2: ₵${withdrawal2.toFixed(2)}`);
            console.log(`Total Commission: ₵${(isFull1 ? clientRate : 0) + (isFull2 ? clientRate : 0)}`);
            console.log(`  - Commission from Withdrawal 1: ₵${isFull1 ? clientRate.toFixed(2) : '0.00'}`);
            console.log(`  - Commission from Withdrawal 2: ₵${isFull2 ? clientRate.toFixed(2) : '0.00'}`);
            console.log(`Final Balance: ₵${balance.toFixed(2)}`);
            console.log(`Final Cumulative: ₵${cumulative.toFixed(2)}`);
            console.log(`\n✅ Expected Result: Balance = ₵0.00, Commission = ₵50.00`);
            
            process.exit(0);
        });
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

testCommissionLogic();

