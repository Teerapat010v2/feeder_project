process.env.POSTGRES_URL = process.env.POSTGRES_URL || "postgresql://neondb_owner:npg_5MlVr8ydotek@ep-fancy-fog-az5nx75w-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
const { sql } = require('@vercel/postgres');

module.exports = async function handler(req, res) {
    const rawDeviceId = req.headers["x-device-id"] || process.env.DEVICE_ID || "Prototype_01";
    const DEVICE_ID = decodeURIComponent(rawDeviceId);

    if (req.method === 'GET') {
        try {
            const limit = req.query.limit || 100;
            await sql.query(`
                CREATE TABLE IF NOT EXISTS "${DEVICE_ID}" (
                    id SERIAL PRIMARY KEY,
                    device_id VARCHAR(50) NOT NULL,
                    amount NUMERIC NOT NULL,
                    mode VARCHAR(20) DEFAULT 'manual',
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    raw_ts VARCHAR(50)
                );
            `);
            const { rows } = await sql.query(`
                SELECT id, amount, mode, timestamp, raw_ts 
                FROM "${DEVICE_ID}"
                ORDER BY timestamp DESC 
                LIMIT $1
            `, [limit]);
            const history = rows.map(row => ({
                id: String(row.id),
                amount: Number(row.amount),
                mode: row.mode,
                timestamp: row.timestamp,
                raw_ts: row.raw_ts
            }));
            return res.status(200).json(history);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Database error' });
        }
    } 
    
    if (req.method === 'POST') {
        try {
            const { amount, mode, timestamp } = req.body;
            await sql.query(`
                CREATE TABLE IF NOT EXISTS "${DEVICE_ID}" (
                    id SERIAL PRIMARY KEY,
                    device_id VARCHAR(50) NOT NULL,
                    amount NUMERIC NOT NULL,
                    mode VARCHAR(20) DEFAULT 'manual',
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    raw_ts VARCHAR(50)
                );
            `);
            
            // Alter table to add raw_ts if it was created before this update
            try {
                await sql.query(`ALTER TABLE "${DEVICE_ID}" ADD COLUMN IF NOT EXISTS raw_ts VARCHAR(50);`);
            } catch(e) {}
            
            let d = timestamp ? new Date(timestamp) : null;
            if(d && !isNaN(d.getTime()) && d.getFullYear() > 2020) {
                await sql.query(`
                    INSERT INTO "${DEVICE_ID}" (device_id, amount, mode, timestamp, raw_ts)
                    VALUES ($1, $2, $3, $4, $5)
                `, [DEVICE_ID, amount !== undefined ? amount : 10, mode || 'manual', d, timestamp || '']);
            } else {
                await sql.query(`
                    INSERT INTO "${DEVICE_ID}" (device_id, amount, mode, timestamp, raw_ts)
                    VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)
                `, [DEVICE_ID, amount !== undefined ? amount : 10, mode || 'manual', timestamp || '']);
            }
            return res.status(200).json({ success: true });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Database error' });
        }
    }

    if (req.method === 'DELETE') {
        try {
            await sql.query(`DELETE FROM "${DEVICE_ID}"`);
            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(200).json({ success: true });
        }
    }

    res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
}
