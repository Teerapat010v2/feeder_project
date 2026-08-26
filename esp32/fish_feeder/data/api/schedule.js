process.env.POSTGRES_URL = process.env.POSTGRES_URL || "postgresql://neondb_owner:npg_5MlVr8ydotek@ep-fancy-fog-az5nx75w-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
const { sql } = require('@vercel/postgres');

module.exports = async function handler(req, res) {
    const rawDeviceId = req.headers["x-device-id"] || process.env.DEVICE_ID || "Prototype_01";
    const DEVICE_ID = decodeURIComponent(rawDeviceId);

    if (req.method === 'GET') {
        // Table deleted by user request, schedules are handled by ESP32 memory via MQTT
        return res.status(200).json([]);
    } 
    
    if (req.method === 'POST') {
        // Table deleted by user request, schedules are handled by ESP32 memory via MQTT
        return res.status(200).json({ success: true });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
}
