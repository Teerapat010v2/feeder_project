process.env.POSTGRES_URL = process.env.POSTGRES_URL || "postgresql://neondb_owner:npg_5MlVr8ydotek@ep-fancy-fog-az5nx75w-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
const { sql } = require('@vercel/postgres');
const mqtt = require('mqtt');

// สำหรับ Vercel Cron จะต้องรันทุกนาที (* * * * *)
module.exports = async function handler(req, res) {
    try {
        // ดึงเวลาปัจจุบันในไทย (HH:mm)
        const now = new Date();
        const thTime = new Intl.DateTimeFormat('en-GB', { 
            timeZone: 'Asia/Bangkok',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false 
        }).format(now);

        console.log(`[CRON] Triggered at ${thTime}`);

        // ดึงรายการตารางเวลาที่เปิดใช้งาน และเวลาตรงกับปัจจุบัน
        const { rows } = await sql`
            SELECT device_id, amount 
            FROM schedules 
            WHERE enable = true AND time = ${thTime}
        `;

        if (rows.length === 0) {
            return res.status(200).json({ success: true, message: 'No schedules for this minute' });
        }

        console.log(`[CRON] Found ${rows.length} schedules to execute.`);

        // เชื่อมต่อ MQTT
        const mqttOptions = {
            protocol: "mqtts",
            host: process.env.MQTT_HOST || "e7343e0d8fa04b38bc8614522fb09796.s1.eu.hivemq.cloud",
            port: Number(process.env.MQTT_PORT) || 8883,
            username: process.env.MQTT_USER || "feeder_admin",
            password: process.env.MQTT_PASS || "Feeder@123",
            connectTimeout: 5000,
            rejectUnauthorized: false
        };

        const client = mqtt.connect(mqttOptions);

        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                client.end();
                reject(new Error("MQTT Connection Timeout"));
            }, 5000);

            client.on("connect", () => {
                clearTimeout(timeout);
                
                let promises = rows.map(row => {
                    return new Promise((res, rej) => {
                        const topic = `fishfeeder/${row.device_id}/cmd/command`;
                        const payload = JSON.stringify({
                            action: "FEED",
                            amount: Number(row.amount)
                        });
                        client.publish(topic, payload, { qos: 1 }, (err) => {
                            if (err) rej(err);
                            else {
                                console.log(`[CRON] Published FEED ${row.amount}g to ${topic}`);
                                res();
                            }
                        });
                    });
                });

                Promise.all(promises).then(() => {
                    client.end();
                    resolve();
                }).catch(err => {
                    client.end();
                    reject(err);
                });
            });

            client.on("error", (err) => {
                clearTimeout(timeout);
                client.end();
                reject(err);
            });
        });

        return res.status(200).json({ success: true, executed: rows.length });
    } catch (error) {
        console.error("[CRON] Error:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
