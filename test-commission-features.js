/**
 * Test script for commission system features
 * Tests all new endpoints and functionality
 */

const http = require('http');

const API_BASE = 'http://localhost:3000';
let authToken = null;
let testClientId = null;
let testAgentId = null;

// Helper function to make HTTP requests
function makeRequest(method, path, data = null, token = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(`${API_BASE}${path}`);
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        if (token) {
            options.headers['Authorization'] = `Bearer ${token}`;
        }

        if (data) {
            options.body = JSON.stringify(data);
        }

        const req = http.request(url, options, (res) => {
            let body = '';
            res.on('data', (chunk) => {
                body += chunk;
            });
            res.on('end', () => {
                try {
                    const parsed = body ? JSON.parse(body) : {};
                    resolve({ status: res.statusCode, data: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        if (data) {
            req.write(JSON.stringify(data));
        }

        req.end();
    });
}

// Test functions
async function testLogin() {
    console.log('\n🔐 Testing Login...');
    try {
        // Try to login - you may need to create an admin account first
        // For now, let's check if we can access the API without auth first
        const response = await makeRequest('POST', '/api/auth/login', {
            email: 'admin@luckysusu.com',
            password: 'admin123' // Update with actual admin password or create admin first
        });

        if (response.status === 200 && response.data.success) {
            authToken = response.data.token;
            testAgentId = response.data.user.id;
            console.log('✅ Login successful');
            return true;
        } else {
            console.log('❌ Login failed:', response.data.error || response.data);
            return false;
        }
    } catch (error) {
        console.log('❌ Login error:', error.message);
        return false;
    }
}

async function testGetClients() {
    console.log('\n📋 Testing Get Clients...');
    try {
        const response = await makeRequest('GET', '/clients', null, authToken);
        if (response.status === 200 && response.data.success && response.data.data.length > 0) {
            testClientId = response.data.data[0].id;
            console.log(`✅ Found ${response.data.data.length} client(s)`);
            console.log(`   Using client ID: ${testClientId} for testing`);
            return true;
        } else {
            console.log('❌ No clients found or error:', response.data);
            return false;
        }
    } catch (error) {
        console.log('❌ Get clients error:', error.message);
        return false;
    }
}

async function testGetCommissionCycle() {
    console.log('\n📊 Testing Get Commission Cycle...');
    if (!testClientId) {
        console.log('⏭️  Skipping - No client ID available');
        return false;
    }
    try {
        const response = await makeRequest('GET', `/clients/${testClientId}/commission-cycle`, null, authToken);
        if (response.status === 200 && response.data.success) {
            const cycle = response.data.data;
            console.log('✅ Commission cycle retrieved:');
            console.log(`   - Cumulative: ₵${cycle.cumulative_withdrawal || 0}`);
            console.log(`   - Threshold: ₵${cycle.client_rate || 0}`);
            console.log(`   - Remaining: ₵${cycle.remaining_to_threshold || 0}`);
            console.log(`   - Threshold Reached: ${cycle.threshold_reached ? 'Yes' : 'No'}`);
            return true;
        } else {
            console.log('❌ Get commission cycle failed:', response.data.error || response.data);
            return false;
        }
    } catch (error) {
        console.log('❌ Get commission cycle error:', error.message);
        return false;
    }
}

async function testGetCommissionHistory() {
    console.log('\n📜 Testing Get Commission History...');
    if (!testClientId) {
        console.log('⏭️  Skipping - No client ID available');
        return false;
    }
    try {
        const response = await makeRequest('GET', `/clients/${testClientId}/commission-history`, null, authToken);
        if (response.status === 200 && response.data.success) {
            const history = response.data.data;
            console.log(`✅ Commission history retrieved: ${history.length} commission(s) found`);
            if (history.length > 0) {
                console.log(`   Latest: ₵${Math.abs(history[0].amount)} on ${history[0].transaction_date}`);
            }
            return true;
        } else {
            console.log('❌ Get commission history failed:', response.data.error || response.data);
            return false;
        }
    } catch (error) {
        console.log('❌ Get commission history error:', error.message);
        return false;
    }
}

async function testGetPendingCycles() {
    console.log('\n⏳ Testing Get Pending Commission Cycles (Admin)...');
    try {
        const response = await makeRequest('GET', '/admin/commission-cycles/pending', null, authToken);
        if (response.status === 200 && response.data.success) {
            const pending = response.data.data;
            console.log(`✅ Pending cycles retrieved: ${pending.length} client(s) with pending cycles`);
            if (pending.length > 0) {
                pending.slice(0, 3).forEach((cycle, idx) => {
                    console.log(`   ${idx + 1}. ${cycle.client_name}: ₵${cycle.cumulative_withdrawal}/${cycle.client_rate}`);
                });
            }
            return true;
        } else {
            console.log('❌ Get pending cycles failed:', response.data.error || response.data);
            return false;
        }
    } catch (error) {
        console.log('❌ Get pending cycles error:', error.message);
        return false;
    }
}

async function testDatabaseFunctions() {
    console.log('\n🗄️  Testing Database Functions...');
    try {
        const { CommissionCycle, Client } = require('./database');
        
        // Test getByClientId
        if (testClientId) {
            const cycle = await CommissionCycle.getByClientId(testClientId);
            console.log('✅ CommissionCycle.getByClientId() works');
            console.log(`   Cumulative: ₵${cycle.cumulative_withdrawal || 0}`);
        }

        // Test getAllPending
        const pending = await CommissionCycle.getAllPending();
        console.log(`✅ CommissionCycle.getAllPending() works - ${pending.length} pending`);
        
        return true;
    } catch (error) {
        console.log('❌ Database functions test error:', error.message);
        return false;
    }
}

// Main test runner
async function runTests() {
    console.log('🧪 Starting Commission System Tests...\n');
    console.log('=' .repeat(60));

    const results = {
        login: false,
        getClients: false,
        getCommissionCycle: false,
        getCommissionHistory: false,
        getPendingCycles: false,
        databaseFunctions: false
    };

    // Run tests
    results.login = await testLogin();
    if (!results.login) {
        console.log('\n⚠️  Cannot continue without authentication. Please check admin credentials.');
        return;
    }

    results.getClients = await testGetClients();
    results.getCommissionCycle = await testGetCommissionCycle();
    results.getCommissionHistory = await testGetCommissionHistory();
    results.getPendingCycles = await testGetPendingCycles();
    results.databaseFunctions = await testDatabaseFunctions();

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Test Summary:');
    console.log('='.repeat(60));
    Object.entries(results).forEach(([test, passed]) => {
        console.log(`${passed ? '✅' : '❌'} ${test}: ${passed ? 'PASSED' : 'FAILED'}`);
    });

    const passed = Object.values(results).filter(r => r).length;
    const total = Object.keys(results).length;
    console.log(`\n📈 Results: ${passed}/${total} tests passed`);

    if (passed === total) {
        console.log('\n🎉 All tests passed! Commission system is working correctly.');
    } else {
        console.log('\n⚠️  Some tests failed. Please check the errors above.');
    }
}

// Run tests
runTests().catch(error => {
    console.error('\n❌ Test runner error:', error);
    process.exit(1);
});

