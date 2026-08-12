require('dotenv').config();
const { sql } = require('@vercel/postgres');

async function run() {
    try {
        await sql`ALTER TABLE device_state ADD COLUMN IF NOT EXISTS feed_amount NUMERIC DEFAULT 10;`;
        console.log('Column added successfully');
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
run();
