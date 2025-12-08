const { Client, User } = require('./database');

async function getTestAgentId() {
    const agents = await User.getAll();
    if (!agents || agents.length === 0) {
        throw new Error('No agents found. Please register an agent before running the tests.');
    }
    const agent = agents[0];
    console.log(`Using agent "${agent.name}" (ID: ${agent.id}) for API search test cases.\n`);
    return agent.id;
}

// Test the search functionality that powers the API endpoint
async function testAPISearch() {
    console.log('Testing API search endpoint logic...\n');
    
    const testCases = [
        'ohene',
        '0244899440',
        '024',
        '024-489-9440',
        'nan'
    ];
    
    try {
        const agentId = await getTestAgentId();
        for (const searchTerm of testCases) {
            console.log(`Testing search: "${searchTerm}"`);
            try {
                const { data, pagination } = await Client.search(searchTerm, agentId);
                console.log(`  ✅ Success: Found ${data.length} clients (page ${pagination.page}/${Math.max(pagination.totalPages, 1)})`);
                if (data.length > 0) {
                    data.forEach(c => console.log(`     - ${c.name} (${c.phone})`));
                }
            } catch (err) {
                console.log(`  ❌ Error: ${err.message}`);
            }
            console.log('');
        }
        process.exit(0);
    } catch (err) {
        console.error('Failed to run API search tests:', err.message);
        process.exit(1);
    }
}

testAPISearch();

