const http = require('http');

function testHTTPSearch(searchTerm) {
    return new Promise((resolve, reject) => {
        const encodedTerm = encodeURIComponent(searchTerm);
        const options = {
            hostname: 'localhost',
            port: 3000,
            path: `/api/clients/search?q=${encodedTerm}`,
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        };

        console.log(`Testing HTTP request: GET http://localhost:3000${options.path}`);

        const req = http.request(options, (res) => {
            let data = '';

            console.log(`Response Status: ${res.statusCode} ${res.statusMessage}`);

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    console.log('Response Data:', JSON.stringify(parsed, null, 2));
                    resolve(parsed);
                } catch (err) {
                    console.error('Failed to parse JSON:', err);
                    console.log('Raw response:', data);
                    reject(err);
                }
            });
        });

        req.on('error', (err) => {
            console.error('Request error:', err.message);
            reject(err);
        });

        req.end();
    });
}

async function runTests() {
    console.log('Testing HTTP API Search Endpoint\n');
    console.log('Make sure your server is running on port 3000!\n');

    const tests = ['ohene', '0244899440', '024'];

    for (const term of tests) {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`Test: Searching for "${term}"`);
        console.log('='.repeat(50));
        try {
            await testHTTPSearch(term);
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait between requests
        } catch (err) {
            console.error('Test failed:', err.message);
        }
    }

    process.exit(0);
}

runTests();

