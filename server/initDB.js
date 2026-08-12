const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const { sql } = require("@vercel/postgres");

async function initDB() {
    try {
        console.log("Creating tables...");

        await sql`
            CREATE TABLE IF NOT EXISTS device_state (
                device_id VARCHAR(50) PRIMARY KEY,
                online BOOLEAN DEFAULT false,
                feeding BOOLEAN DEFAULT false,
                weight NUMERIC DEFAULT 0,
                food_level VARCHAR(20) DEFAULT 'green',
                daily_usage NUMERIC DEFAULT 100,
                firmware VARCHAR(20),
                ip VARCHAR(20),
                wifi NUMERIC DEFAULT 0,
                feed_amount NUMERIC DEFAULT 10,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;
        console.log("✅ Created device_state table");

        await sql`
            CREATE TABLE IF NOT EXISTS feed_history (
                id SERIAL PRIMARY KEY,
                device_id VARCHAR(50) NOT NULL,
                amount NUMERIC NOT NULL,
                mode VARCHAR(20) DEFAULT 'manual',
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;
        console.log("✅ Created feed_history table");

        await sql`
            CREATE TABLE IF NOT EXISTS alerts (
                id SERIAL PRIMARY KEY,
                device_id VARCHAR(50) NOT NULL,
                message TEXT NOT NULL,
                level VARCHAR(20) DEFAULT 'info',
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;
        console.log("✅ Created alerts table");

        await sql`
            CREATE TABLE IF NOT EXISTS schedules (
                id SERIAL PRIMARY KEY,
                device_id VARCHAR(50) NOT NULL,
                time VARCHAR(5) NOT NULL,
                enable BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;
        console.log("✅ Created schedules table");

        console.log("🎉 Database initialization completed successfully.");
    } catch (error) {
        console.error("❌ Error initializing database:", error);
    }
}

initDB();
