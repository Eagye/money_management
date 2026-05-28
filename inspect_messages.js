const { initDatabase, getDatabase } = require('./database');

async function main() {
    await initDatabase();
    const db = getDatabase();

    db.all(
        `SELECT id, message_type, phone_number, status, provider_message_id, created_at, sent_at, failed_at
         FROM messages
         ORDER BY id DESC
         LIMIT 30`,
        (err, rows) => {
            if (err) {
                console.error(err);
                process.exit(1);
                return;
            }
            console.log(JSON.stringify(rows, null, 2));
            process.exit(0);
        }
    );
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
