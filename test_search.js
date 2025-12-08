const { Client, User } = require('./database');

async function getTestAgentId() {
    const agents = await User.getAll();
    if (!agents || agents.length === 0) {
        throw new Error('No agents found. Please register an agent before running the tests.');
    }
    const agent = agents[0];
    console.log(`\nUsing agent "${agent.name}" (ID: ${agent.id}) for all search tests.\n`);
    return agent.id;
}

async function runSearchTest(description, term, agentId) {
    console.log(description);
    try {
        const { data, pagination } = await Client.search(term, agentId);
        console.log(`Results: ${data.length} clients found (page ${pagination.page}/${Math.max(pagination.totalPages, 1)})`);
        data.forEach(c => console.log(`  - ${c.name} (${c.phone})`));
    } catch (err) {
        console.error('Error:', err.message);
    }
    console.log('\n');
}

async function testSearch() {
    console.log('Testing search functionality...\n');
    try {
        const agentId = await getTestAgentId();
        await runSearchTest('Test 1: Searching for "ohene" (name)', 'ohene', agentId);
        await runSearchTest('Test 2: Searching for "0244899440" (phone)', '0244899440', agentId);
        await runSearchTest('Test 3: Searching for "024" (partial phone)', '024', agentId);
        await runSearchTest('Test 4: Searching for "024-489-9440" (phone with dashes)', '024-489-9440', agentId);
        await runSearchTest('Test 5: Searching for "nan" (partial name)', 'nan', agentId);
        process.exit(0);
    } catch (err) {
        console.error('Failed to run tests:', err.message);
        process.exit(1);
    }
}

testSearch();

