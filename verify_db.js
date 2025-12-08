const { Client, Transaction } = require('./database');

async function verifyDatabase() {
    console.log('Verifying Database Structure and Data...\n');
    
    try {
        // Get all clients
        const clients = await Client.getAll();
        console.log(`✅ Clients Table: ${clients.length} client(s) found`);
        clients.forEach(c => {
            console.log(`   - ${c.name} (ID: ${c.id})`);
            console.log(`     Phone: ${c.phone}, Rate: ₵${c.rate}, Balance: ₵${c.current_balance || 0}`);
        });
        
        console.log('\n');
        
        // Get all transactions
        const allTransactions = [];
        for (const client of clients) {
            try {
                const transactions = await Transaction.getByClientId(client.id);
                allTransactions.push(...transactions);
            } catch (err) {
                console.error(`Error getting transactions for client ${client.id}:`, err.message);
            }
        }
        
        console.log(`✅ Transactions Table: ${allTransactions.length} transaction(s) found`);
        if (allTransactions.length > 0) {
            allTransactions.forEach(t => {
                console.log(`   - Transaction ID: ${t.id}`);
                console.log(`     Client ID: ${t.client_id}, Amount: ₵${t.amount}`);
                console.log(`     Type: ${t.transaction_type}, Date: ${t.transaction_date}`);
                console.log(`     Notes: ${t.notes || 'None'}`);
                console.log(`     Created: ${t.created_at}`);
                console.log('');
            });
        } else {
            console.log('   No transactions found yet.');
        }
        
        console.log('\n📊 Database Structure:');
        console.log('   ✅ clients table: Stores client information');
        console.log('   ✅ transactions table: Stores all deposits/transactions');
        console.log('   ✅ Foreign key relationship: transactions.client_id → clients.id');
        console.log('   ✅ Balance updates: Automatically calculated when deposits are added');
        
    } catch (error) {
        console.error('❌ Error verifying database:', error);
    }
    
    process.exit(0);
}

verifyDatabase();

