const { initDatabase, getDatabase } = require('./database');

async function calculateCommission() {
    try {
        await initDatabase();
        const db = getDatabase();
        
        console.log('💰 Calculating Commission for Yaw Manu\'s Withdrawals\n');
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
            console.log(`Commission Threshold: ₵${threshold.toFixed(2)} (31 boxes × ₵${clientRate.toFixed(2)})\n`);
            
            // Get all transactions in order
            db.all(
                `SELECT * FROM transactions 
                 WHERE client_id = 1 
                 ORDER BY transaction_date ASC, created_at ASC, id ASC`,
                (err, transactions) => {
                    if (err) {
                        console.error('Error:', err);
                        process.exit(1);
                    }
                    
                    let runningBalance = 0;
                    let cumulative = 0;
                    let totalCommissionShouldBe = 0;
                    
                    console.log('📊 Transaction Analysis (with NEW logic):\n');
                    console.log('-'.repeat(80));
                    
                    for (const txn of transactions) {
                        const amount = parseFloat(txn.amount);
                        const absAmount = Math.abs(amount);
                        
                        if (txn.transaction_type === 'deposit') {
                            runningBalance += amount;
                            console.log(`\n✅ DEPOSIT #${txn.id}`);
                            console.log(`   Amount: +₵${absAmount.toFixed(2)}`);
                            console.log(`   Balance After: ₵${runningBalance.toFixed(2)}`);
                        } else if (txn.transaction_type === 'withdrawal') {
                            const balanceBefore = runningBalance;
                            const withdrawalAmount = absAmount;
                            const balanceAfter = runningBalance - withdrawalAmount;
                            
                            // NEW LOGIC: Check if this is a full withdrawal
                            const isFullWithdrawal = balanceAfter <= clientRate;
                            
                            console.log(`\n📤 WITHDRAWAL #${txn.id}`);
                            console.log(`   Amount: ₵${withdrawalAmount.toFixed(2)}`);
                            console.log(`   Balance Before: ₵${balanceBefore.toFixed(2)}`);
                            console.log(`   Balance After: ₵${balanceAfter.toFixed(2)}`);
                            console.log(`   Cumulative Before: ₵${cumulative.toFixed(2)}`);
                            console.log(`   Is Full Withdrawal? ${isFullWithdrawal ? 'YES ✅' : 'NO ❌'}`);
                            console.log(`   Condition: balanceAfter (₵${balanceAfter.toFixed(2)}) <= clientRate (₵${clientRate.toFixed(2)}) = ${isFullWithdrawal}`);
                            
                            // Calculate commission that SHOULD have been deducted
                            let commissionForThisWithdrawal = 0;
                            let clientGets = withdrawalAmount;
                            
                            if (isFullWithdrawal) {
                                // Full withdrawal: deduct commission even if page is incomplete
                                commissionForThisWithdrawal = clientRate;
                                clientGets = withdrawalAmount - commissionForThisWithdrawal;
                                cumulative = 0; // Reset on full withdrawal
                                console.log(`   ✅ FULL WITHDRAWAL DETECTED`);
                                console.log(`   Commission to Deduct: ₵${commissionForThisWithdrawal.toFixed(2)}`);
                                console.log(`   Client Gets: ₵${clientGets.toFixed(2)} (₵${withdrawalAmount.toFixed(2)} - ₵${commissionForThisWithdrawal.toFixed(2)})`);
                            } else {
                                // Normal withdrawal: check if it completes a page
                                const neededForFullPage = threshold - cumulative;
                                
                                if (withdrawalAmount >= neededForFullPage) {
                                    // Completes a full page
                                    const pagesCompleted = Math.floor((cumulative + withdrawalAmount) / threshold);
                                    commissionForThisWithdrawal = pagesCompleted * clientRate;
                                    clientGets = withdrawalAmount - commissionForThisWithdrawal;
                                    cumulative = (cumulative + withdrawalAmount) % threshold;
                                    console.log(`   ✅ Completes ${pagesCompleted} full page(s)`);
                                    console.log(`   Commission to Deduct: ₵${commissionForThisWithdrawal.toFixed(2)}`);
                                    console.log(`   Client Gets: ₵${clientGets.toFixed(2)}`);
                                    console.log(`   New Cumulative: ₵${cumulative.toFixed(2)}`);
                                } else {
                                    // Doesn't complete page, no commission
                                    cumulative += withdrawalAmount;
                                    console.log(`   ℹ️  Page not complete, no commission`);
                                    console.log(`   Client Gets: ₵${clientGets.toFixed(2)}`);
                                    console.log(`   New Cumulative: ₵${cumulative.toFixed(2)}`);
                                }
                            }
                            
                            totalCommissionShouldBe += commissionForThisWithdrawal;
                            runningBalance = balanceAfter;
                            
                            // Check if commission was actually deducted
                            db.get(
                                `SELECT * FROM transactions 
                                 WHERE related_transaction_id = ? AND transaction_type = 'commission'`,
                                [txn.id],
                                (commErr, commission) => {
                                    if (commission) {
                                        const actualCommission = Math.abs(parseFloat(commission.amount));
                                        if (actualCommission === commissionForThisWithdrawal) {
                                            console.log(`   ✅ Commission WAS deducted correctly: ₵${actualCommission.toFixed(2)}`);
                                        } else {
                                            console.log(`   ⚠️  Commission mismatch! Expected: ₵${commissionForThisWithdrawal.toFixed(2)}, Actual: ₵${actualCommission.toFixed(2)}`);
                                        }
                                    } else {
                                        if (commissionForThisWithdrawal > 0) {
                                            console.log(`   ❌ Commission was NOT deducted! Should have been: ₵${commissionForThisWithdrawal.toFixed(2)}`);
                                        } else {
                                            console.log(`   ℹ️  No commission required for this withdrawal`);
                                        }
                                    }
                                }
                            );
                        }
                    }
                    
                    setTimeout(() => {
                        console.log('\n' + '='.repeat(80));
                        console.log('📋 SUMMARY:');
                        console.log('='.repeat(80));
                        console.log(`Total Commission That SHOULD Have Been Deducted: ₵${totalCommissionShouldBe.toFixed(2)}`);
                        console.log(`Final Balance: ₵${runningBalance.toFixed(2)}`);
                        console.log(`Final Cumulative: ₵${cumulative.toFixed(2)}`);
                        console.log('\n');
                        
                        // Get actual commission deducted
                        db.get(
                            `SELECT SUM(ABS(amount)) as total_commission 
                             FROM transactions 
                             WHERE client_id = 1 AND transaction_type = 'commission'`,
                            (sumErr, result) => {
                                const actualCommission = parseFloat(result?.total_commission || 0);
                                console.log(`Total Commission Actually Deducted: ₵${actualCommission.toFixed(2)}`);
                                console.log(`Missing Commission: ₵${(totalCommissionShouldBe - actualCommission).toFixed(2)}`);
                                process.exit(0);
                            }
                        );
                    }, 1000);
                }
            );
        });
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

calculateCommission();

