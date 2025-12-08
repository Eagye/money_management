const { Client, Transaction, CommissionCycle, initDatabase, getDatabase } = require('./database');

async function checkYawManu() {
    try {
        // Initialize database connection
        await initDatabase();
        console.log('Database initialized\n');

        // Search for client "Yaw Manu"
        console.log('🔍 Searching for client "Yaw Manu"...\n');
        
        // Get all clients and search for Yaw Manu (since search requires agent_id)
        const db = getDatabase();
        
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT * FROM clients WHERE LOWER(name) LIKE LOWER(?)`,
                ['%yaw manu%'],
                async (err, clients) => {
                    if (err) {
                        console.error('Error searching for client:', err);
                        reject(err);
                        return;
                    }

                    if (!clients || clients.length === 0) {
                        console.log('❌ No client found with name "Yaw Manu"');
                        console.log('\nTrying alternative search...');
                        
                        // Try searching with different variations
                        db.all(
                            `SELECT * FROM clients WHERE LOWER(name) LIKE LOWER(?) OR LOWER(name) LIKE LOWER(?)`,
                            ['%yaw%', '%manu%'],
                            async (err2, clients2) => {
                                if (err2) {
                                    console.error('Error in alternative search:', err2);
                                    reject(err2);
                                    return;
                                }
                                
                                if (!clients2 || clients2.length === 0) {
                                    console.log('❌ No clients found with similar names');
                                    process.exit(0);
                                } else {
                                    console.log(`\nFound ${clients2.length} client(s) with similar names:\n`);
                                    clients2.forEach(c => {
                                        console.log(`  - ${c.name} (ID: ${c.id}, Phone: ${c.phone})`);
                                    });
                                    process.exit(0);
                                }
                            }
                        );
                        return;
                    }

                    // Found client(s)
                    console.log(`✅ Found ${clients.length} client(s) with name "Yaw Manu":\n`);
                    
                    for (const client of clients) {
                        await analyzeClient(client);
                    }
                    
                    process.exit(0);
                }
            );
        });
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

async function analyzeClient(client) {
    console.log('='.repeat(80));
    console.log(`📋 CLIENT INFORMATION`);
    console.log('='.repeat(80));
    console.log(`ID: ${client.id}`);
    console.log(`Name: ${client.name}`);
    console.log(`Phone: ${client.phone}`);
    console.log(`Gender: ${client.gender}`);
    console.log(`Rate: ₵${client.rate}`);
    console.log(`Current Balance: ₵${client.current_balance || 0}`);
    console.log(`Agent ID: ${client.agent_id}`);
    console.log(`Created: ${client.created_at}`);
    console.log('');

    // Get commission cycle information
    console.log('📊 COMMISSION CYCLE INFORMATION');
    console.log('-'.repeat(80));
    try {
        const commissionCycle = await CommissionCycle.getByClientId(client.id);
        const threshold = 31 * parseFloat(client.rate);
        const cumulative = parseFloat(commissionCycle.cumulative_withdrawal || 0);
        const remaining = Math.max(0, threshold - cumulative);
        
        console.log(`Cumulative Withdrawal: ₵${cumulative.toFixed(2)}`);
        console.log(`Commission Threshold: ₵${threshold.toFixed(2)} (31 boxes × ₵${client.rate})`);
        console.log(`Remaining to Threshold: ₵${remaining.toFixed(2)}`);
        console.log(`Threshold Reached: ${cumulative >= threshold ? 'YES' : 'NO'}`);
        console.log(`Last Updated: ${commissionCycle.updated_at || 'Never'}`);
        console.log('');
    } catch (err) {
        console.log(`Error getting commission cycle: ${err.message}`);
        console.log('');
    }

    // Get all transactions for this client
    console.log('💳 TRANSACTION HISTORY');
    console.log('-'.repeat(80));
    
    return new Promise((resolve, reject) => {
        const db = getDatabase();
        
        db.all(
            `SELECT * FROM transactions 
             WHERE client_id = ? 
             ORDER BY transaction_date DESC, created_at DESC, id DESC`,
            [client.id],
            async (err, transactions) => {
                if (err) {
                    console.error('Error getting transactions:', err);
                    reject(err);
                    return;
                }

                if (!transactions || transactions.length === 0) {
                    console.log('No transactions found for this client.\n');
                    resolve();
                    return;
                }

                console.log(`Total Transactions: ${transactions.length}\n`);

                // Filter withdrawals and commissions
                const withdrawals = transactions.filter(t => t.transaction_type === 'withdrawal');
                const commissions = transactions.filter(t => t.transaction_type === 'commission');
                const deposits = transactions.filter(t => t.transaction_type === 'deposit');

                console.log(`📤 WITHDRAWALS: ${withdrawals.length}`);
                if (withdrawals.length > 0) {
                    let totalWithdrawal = 0;
                    withdrawals.forEach((w, index) => {
                        const amount = Math.abs(parseFloat(w.amount));
                        totalWithdrawal += amount;
                        console.log(`\n  ${index + 1}. Withdrawal #${w.id}`);
                        console.log(`     Date: ${w.transaction_date}`);
                        console.log(`     Amount: ₵${amount.toFixed(2)}`);
                        console.log(`     Notes: ${w.notes || 'N/A'}`);
                        
                        // Check if there's a related commission transaction
                        const relatedCommission = commissions.find(c => c.related_transaction_id === w.id);
                        if (relatedCommission) {
                            const commAmount = Math.abs(parseFloat(relatedCommission.amount));
                            console.log(`     ✅ Commission Deducted: ₵${commAmount.toFixed(2)}`);
                            console.log(`        Commission Transaction ID: ${relatedCommission.id}`);
                            console.log(`        Commission Notes: ${relatedCommission.notes || 'N/A'}`);
                        } else {
                            console.log(`     ❌ NO COMMISSION DEDUCTED`);
                        }
                    });
                    console.log(`\n  Total Withdrawal Amount: ₵${totalWithdrawal.toFixed(2)}`);
                } else {
                    console.log('  No withdrawals found.');
                }

                console.log(`\n💰 COMMISSIONS: ${commissions.length}`);
                if (commissions.length > 0) {
                    let totalCommission = 0;
                    commissions.forEach((c, index) => {
                        const amount = Math.abs(parseFloat(c.amount));
                        totalCommission += amount;
                        console.log(`\n  ${index + 1}. Commission #${c.id}`);
                        console.log(`     Date: ${c.transaction_date}`);
                        console.log(`     Amount: ₵${amount.toFixed(2)}`);
                        console.log(`     Related Withdrawal ID: ${c.related_transaction_id || 'N/A'}`);
                        console.log(`     Notes: ${c.notes || 'N/A'}`);
                    });
                    console.log(`\n  Total Commission Amount: ₵${totalCommission.toFixed(2)}`);
                } else {
                    console.log('  No commission transactions found.');
                }

                console.log(`\n📥 DEPOSITS: ${deposits.length}`);
                if (deposits.length > 0) {
                    let totalDeposit = 0;
                    deposits.forEach((d, index) => {
                        const amount = parseFloat(d.amount);
                        totalDeposit += amount;
                        console.log(`  ${index + 1}. Deposit #${d.id} - ₵${amount.toFixed(2)} on ${d.transaction_date}`);
                    });
                    console.log(`  Total Deposit Amount: ₵${totalDeposit.toFixed(2)}`);
                }

                // Analysis
                console.log('\n' + '='.repeat(80));
                console.log('🔍 ANALYSIS');
                console.log('='.repeat(80));
                
                if (withdrawals.length > 0) {
                    const withdrawalsWithoutCommission = withdrawals.filter(w => {
                        return !commissions.some(c => c.related_transaction_id === w.id);
                    });
                    
                    if (withdrawalsWithoutCommission.length > 0) {
                        console.log(`\n⚠️  WITHDRAWALS WITHOUT COMMISSION: ${withdrawalsWithoutCommission.length}`);
                        
                        // Get current commission cycle once
                        const commissionCycle = await CommissionCycle.getByClientId(client.id);
                        const cumulative = parseFloat(commissionCycle.cumulative_withdrawal || 0);
                        
                        for (let index = 0; index < withdrawalsWithoutCommission.length; index++) {
                            const w = withdrawalsWithoutCommission[index];
                            const amount = Math.abs(parseFloat(w.amount));
                            const threshold = 31 * parseFloat(client.rate);
                            console.log(`\n  ${index + 1}. Withdrawal #${w.id} - ₵${amount.toFixed(2)} on ${w.transaction_date}`);
                            
                            // Get cumulative at the time of withdrawal (approximate)
                            // We need to look at withdrawals before this one
                            const withdrawalDate = w.transaction_date;
                            const earlierWithdrawals = withdrawals.filter(ww => 
                                ww.transaction_date < withdrawalDate || 
                                (ww.transaction_date === withdrawalDate && ww.id < w.id)
                            );
                            
                            // Calculate approximate cumulative before this withdrawal
                            // This is simplified - in reality, we'd need to track the exact state
                            console.log(`     Possible Reasons:`);
                            console.log(`     - Withdrawal amount (₵${amount.toFixed(2)}) may not have completed a full page`);
                            console.log(`     - Full page threshold: ₵${threshold.toFixed(2)} (31 boxes × ₵${client.rate})`);
                            console.log(`     - Commission is only deducted when a FULL page (31 boxes) is completed`);
                            console.log(`     - Current cumulative: ₵${cumulative.toFixed(2)}`);
                            
                            if (amount < threshold) {
                                console.log(`     - This withdrawal (₵${amount.toFixed(2)}) is less than threshold (₵${threshold.toFixed(2)})`);
                                console.log(`     - It would need to accumulate to ₵${threshold.toFixed(2)} before commission is deducted`);
                            }
                        }
                    } else {
                        console.log('\n✅ All withdrawals have associated commission transactions.');
                    }
                } else {
                    console.log('\nℹ️  No withdrawals found to analyze.');
                }

                console.log('\n' + '='.repeat(80));
                resolve();
            }
        );
    });
}

// Run the check
checkYawManu();

