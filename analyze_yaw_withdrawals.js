const { initDatabase, getDatabase } = require('./database');

async function analyzeWithdrawals() {
    try {
        await initDatabase();
        const db = getDatabase();
        
        console.log('🔍 Analyzing Yaw Manu\'s Withdrawals\n');
        console.log('='.repeat(80));
        
        // Get client
        db.get('SELECT * FROM clients WHERE id = 1', async (err, client) => {
            if (err) {
                console.error('Error:', err);
                process.exit(1);
            }
            
            console.log(`Client: ${client.name}`);
            console.log(`Rate: ₵${client.rate}`);
            console.log(`Current Balance: ₵${client.current_balance}\n`);
            
            // Get all transactions in order
            db.all(
                `SELECT * FROM transactions 
                 WHERE client_id = 1 
                 ORDER BY transaction_date ASC, created_at ASC, id ASC`,
                async (err, transactions) => {
                    if (err) {
                        console.error('Error:', err);
                        process.exit(1);
                    }
                    
                    let runningBalance = 0;
                    let cumulative = 0;
                    const threshold = 31 * parseFloat(client.rate);
                    
                    console.log('📊 Transaction Timeline:\n');
                    console.log('-'.repeat(80));
                    
                    for (const txn of transactions) {
                        const amount = parseFloat(txn.amount);
                        const absAmount = Math.abs(amount);
                        
                        if (txn.transaction_type === 'deposit') {
                            runningBalance += amount;
                            console.log(`\n✅ DEPOSIT #${txn.id}`);
                            console.log(`   Date: ${txn.transaction_date}`);
                            console.log(`   Amount: +₵${absAmount.toFixed(2)}`);
                            console.log(`   Balance After: ₵${runningBalance.toFixed(2)}`);
                            console.log(`   Cumulative: ₵${cumulative.toFixed(2)}`);
                        } else if (txn.transaction_type === 'withdrawal') {
                            const balanceBefore = runningBalance;
                            const withdrawalAmount = absAmount;
                            const balanceAfter = runningBalance - withdrawalAmount;
                            const clientRate = parseFloat(client.rate);
                            
                            // Check if this is a full withdrawal
                            const isFullWithdrawal = balanceAfter < clientRate;
                            
                            console.log(`\n📤 WITHDRAWAL #${txn.id}`);
                            console.log(`   Date: ${txn.transaction_date}`);
                            console.log(`   Amount: -₵${withdrawalAmount.toFixed(2)}`);
                            console.log(`   Balance Before: ₵${balanceBefore.toFixed(2)}`);
                            console.log(`   Balance After: ₵${balanceAfter.toFixed(2)}`);
                            console.log(`   Cumulative Before: ₵${cumulative.toFixed(2)}`);
                            console.log(`   Threshold: ₵${threshold.toFixed(2)}`);
                            console.log(`   Is Full Withdrawal? ${isFullWithdrawal ? 'YES ✅' : 'NO ❌'}`);
                            console.log(`   Condition: balanceAfter (₵${balanceAfter.toFixed(2)}) < clientRate (₵${clientRate.toFixed(2)}) = ${isFullWithdrawal}`);
                            
                            // Check if commission was deducted
                            db.get(
                                `SELECT * FROM transactions 
                                 WHERE related_transaction_id = ? AND transaction_type = 'commission'`,
                                [txn.id],
                                (commErr, commission) => {
                                    if (commErr) {
                                        console.error('Error checking commission:', commErr);
                                        return;
                                    }
                                    
                                    if (commission) {
                                        console.log(`   ✅ Commission Deducted: ₵${Math.abs(parseFloat(commission.amount)).toFixed(2)}`);
                                        console.log(`   Commission Transaction ID: ${commission.id}`);
                                    } else {
                                        console.log(`   ❌ NO COMMISSION DEDUCTED`);
                                        
                                        if (isFullWithdrawal) {
                                            console.log(`   ⚠️  BUG: This is a full withdrawal but commission was NOT deducted!`);
                                        } else {
                                            console.log(`   ℹ️  Not a full withdrawal, so commission not required unless page is complete.`);
                                            console.log(`   ℹ️  Cumulative: ₵${cumulative.toFixed(2)}, needs ₵${threshold.toFixed(2)} to complete page.`);
                                        }
                                    }
                                }
                            );
                            
                            // Update running balance and cumulative
                            runningBalance = balanceAfter;
                            
                            // Update cumulative (simplified - actual logic is more complex)
                            if (isFullWithdrawal) {
                                cumulative = 0; // Should reset on full withdrawal
                            } else {
                                // Check if this completes a page
                                const neededForFullPage = threshold - cumulative;
                                if (withdrawalAmount >= neededForFullPage) {
                                    // Completes a page
                                    const pagesCompleted = Math.floor((cumulative + withdrawalAmount) / threshold);
                                    cumulative = (cumulative + withdrawalAmount) % threshold;
                                    console.log(`   📄 Completed ${pagesCompleted} full page(s), new cumulative: ₵${cumulative.toFixed(2)}`);
                                } else {
                                    // Doesn't complete page
                                    cumulative += withdrawalAmount;
                                    console.log(`   📄 Page not complete, new cumulative: ₵${cumulative.toFixed(2)}`);
                                }
                            }
                        }
                    }
                    
                    console.log('\n' + '='.repeat(80));
                    console.log('\n📋 Summary:');
                    console.log(`Final Balance: ₵${runningBalance.toFixed(2)}`);
                    console.log(`Final Cumulative: ₵${cumulative.toFixed(2)}`);
                    
                    setTimeout(() => process.exit(0), 2000);
                }
            );
        });
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

analyzeWithdrawals();

