const http = require('http');
const { initDatabase, getDatabase, Message } = require('./database');

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function onRun(err) {
            if (err) {
                reject(err);
                return;
            }
            resolve(this);
        });
    });
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(row);
        });
    });
}

async function main() {
    await initDatabase();
    const db = getDatabase();

    const unique = Date.now();
    const email = `webhook.tester.${unique}@example.com`;
    const phone = `024${String(unique).slice(-7)}`;

    const userInsert = await run(
        db,
        `INSERT INTO users (name, email, password, contact, validation_card_number, guarantor_number, guarantor_validation_number, is_admin, is_approved, created_by_admin)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 0)`,
        ['Webhook Tester', email, 'x', '0240000002', 'GHA-123456789-1', '0240000003', 'GHA-123456788-1']
    );

    const clientInsert = await run(
        db,
        `INSERT INTO clients (name, phone, gender, rate, current_balance, agent_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['Webhook Client', phone, 'Male', 10, 100, userInsert.lastID]
    );

    const message = await Message.create({
        client_id: clientInsert.lastID,
        transaction_id: null,
        message_type: 'test',
        message: 'delivery webhook test',
        phone_number: phone,
        status: 'sent'
    });

    await Message.updateStatus(message.id, 'sent', {
        providerMessageId: 'webhook-test-123'
    });

    const payload = JSON.stringify({ id: 'webhook-test-123', status: 'delivered' });
    const responseBody = await new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: 'localhost',
                port: 3000,
                path: '/api/webhooks/arkesel/delivery',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload)
                }
            },
            (res) => {
                let body = '';
                res.on('data', (chunk) => {
                    body += chunk;
                });
                res.on('end', () => {
                    resolve({ statusCode: res.statusCode, body });
                });
            }
        );
        req.on('error', reject);
        req.write(payload);
        req.end();
    });

    const row = await get(
        db,
        `SELECT status, provider_message_id, delivered_at FROM messages WHERE id = ?`,
        [message.id]
    );

    console.log(JSON.stringify({ responseBody, row }, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
