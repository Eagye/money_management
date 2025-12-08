const { Client } = require('./database');

async function checkClients() {
    try {
        console.log('Checking clients in database...\n');
        const clients = await Client.getAll();
        
        if (clients.length === 0) {
            console.log('❌ No clients found in database.');
            console.log('Please register a client first using the registration form.');
        } else {
            console.log(`✅ Found ${clients.length} client(s) in database:\n`);
            clients.forEach((client, index) => {
                console.log(`${index + 1}. ID: ${client.id}`);
                console.log(`   Name: ${client.name}`);
                console.log(`   Phone: ${client.phone}`);
                console.log(`   Gender: ${client.gender}`);
                console.log(`   Rate: ₵${client.rate}`);
                console.log(`   Balance: ₵${client.current_balance || 0}`);
                console.log(`   Created: ${client.created_at}`);
                console.log('');
            });
        }
        
        // Also show stats
        const stats = await Client.getStats();
        console.log('📊 Statistics:');
        console.log(`   Total: ${stats.total_clients}`);
        console.log(`   Male: ${stats.male_count}`);
        console.log(`   Female: ${stats.female_count}`);
        console.log(`   Other: ${stats.other_count}`);
        
    } catch (error) {
        console.error('Error checking clients:', error);
    }
    
    process.exit(0);
}

checkClients();

