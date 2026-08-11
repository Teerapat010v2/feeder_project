process.env.POSTGRES_URL = process.env.POSTGRES_URL || "postgresql://neondb_owner:npg_5MlVr8ydotek@ep-fancy-fog-az5nx75w-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
const { sql } = require('@vercel/postgres');

const DEVICE_ID = process.env.DEVICE_ID || "device123";

export default async function handler(req, res) {
    if (req.method === 'GET') {
        try {
            const { rows } = await sql`
                SELECT id, time, amount, enable, created_at 
                FROM schedules 
                WHERE device_id = ${DEVICE_ID} 
                ORDER BY time ASC
            `;
            const schedules = rows.map(row => ({
                id: String(row.id),
                time: row.time,
                amount: Number(row.amount),
                enable: row.enable,
                createdAt: row.created_at
            }));
            return res.status(200).json(schedules);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Database error' });
        }
    } 
    
    if (req.method === 'POST') {
        try {
            const { schedules } = req.body;
            if (!Array.isArray(schedules)) {
                return res.status(400).json({ success: false, message: 'Invalid format' });
            }

            // Delete old schedules
            await sql`DELETE FROM schedules WHERE device_id = ${DEVICE_ID}`;

            // Insert new ones
            for (const item of schedules) {
                await sql`
                    INSERT INTO schedules (device_id, time, amount, enable, created_at)
                    VALUES (${DEVICE_ID}, ${item.time}, ${item.amount ?? 10}, ${item.enable ?? true}, CURRENT_TIMESTAMP)
                `;
            }
            return res.status(200).json({ success: true });
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Database error' });
        }
    }

    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
}
