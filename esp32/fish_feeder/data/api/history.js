const { sql } = require('@vercel/postgres');

const DEVICE_ID = process.env.DEVICE_ID || "device123";

export default async function handler(req, res) {
    if (req.method === 'GET') {
        try {
            const limit = req.query.limit || 100;
            const { rows } = await sql`
                SELECT id, amount, mode, timestamp 
                FROM feed_history 
                WHERE device_id = ${DEVICE_ID} 
                ORDER BY timestamp DESC 
                LIMIT ${limit}
            `;
            const history = rows.map(row => ({
                id: String(row.id),
                amount: Number(row.amount),
                mode: row.mode,
                timestamp: row.timestamp
            }));
            return res.status(200).json(history);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Database error' });
        }
    } 
    
    if (req.method === 'POST') {
        try {
            const { amount, mode } = req.body;
            await sql`
                INSERT INTO feed_history (device_id, amount, mode, timestamp)
                VALUES (${DEVICE_ID}, ${amount || 10}, ${mode || 'manual'}, CURRENT_TIMESTAMP)
            `;
            return res.status(200).json({ success: true });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Database error' });
        }
    }

    if (req.method === 'DELETE') {
        try {
            await sql`DELETE FROM feed_history WHERE device_id = ${DEVICE_ID}`;
            return res.status(200).json({ success: true });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Database error' });
        }
    }

    res.setHeader('Allow', ['GET', 'POST', 'DELETE']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
}
