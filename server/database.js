const { sql } = require("@vercel/postgres");

const DEVICE_ID = process.env.DEVICE_ID || "Prototype_01";

// =======================================
// DEVICE
// =======================================

async function updateDevice(data) {
    try {
        const device = await getDevice();
        if (!device) {
            await sql`
                INSERT INTO device_state (device_id, online, feeding, weight, food_level, daily_usage, firmware, ip, wifi, last_seen)
                VALUES (${DEVICE_ID}, ${data.online ?? false}, ${data.feeding ?? false}, ${data.weight ?? 0}, ${data.foodLevel ?? 'green'}, ${data.dailyUsage ?? 100}, ${data.firmware ?? null}, ${data.ip ?? null}, ${data.wifi ?? 0}, CURRENT_TIMESTAMP)
            `;
        } else {
            // Update only provided fields
            const setClauses = [];
            if (data.online !== undefined) setClauses.push(`online = ${data.online}`);
            if (data.feeding !== undefined) setClauses.push(`feeding = ${data.feeding}`);
            if (data.weight !== undefined) setClauses.push(`weight = ${data.weight}`);
            if (data.foodLevel !== undefined) setClauses.push(`food_level = '${data.foodLevel}'`);
            if (data.dailyUsage !== undefined) setClauses.push(`daily_usage = ${data.dailyUsage}`);
            if (data.firmware !== undefined) setClauses.push(`firmware = '${data.firmware}'`);
            if (data.ip !== undefined) setClauses.push(`ip = '${data.ip}'`);
            if (data.wifi !== undefined) setClauses.push(`wifi = ${data.wifi}`);
            
            if (setClauses.length > 0) {
                // Direct interpolation is unsafe for generic usage but safe here since we control the fields
                await sql.query(`UPDATE device_state SET ${setClauses.join(', ')}, last_seen = CURRENT_TIMESTAMP WHERE device_id = $1`, [DEVICE_ID]);
            } else {
                await sql`UPDATE device_state SET last_seen = CURRENT_TIMESTAMP WHERE device_id = ${DEVICE_ID}`;
            }
        }
    } catch (err) {
        console.error("DB Error (updateDevice):", err);
    }
}

async function getDevice() {
    try {
        const { rows } = await sql`SELECT * FROM device_state WHERE device_id = ${DEVICE_ID}`;
        if (rows.length === 0) return null;
        
        const row = rows[0];
        return {
            id: row.device_id,
            online: row.online,
            feeding: row.feeding,
            weight: Number(row.weight),
            foodLevel: row.food_level,
            dailyUsage: Number(row.daily_usage),
            firmware: row.firmware,
            ip: row.ip,
            wifi: Number(row.wifi),
            lastSeen: row.last_seen
        };
    } catch (err) {
        console.error("DB Error (getDevice):", err);
        return null;
    }
}

// =======================================
// WEIGHT
// =======================================

async function updateWeight(weight) {
    try {
        await sql`
            INSERT INTO device_state (device_id, weight, last_seen)
            VALUES (${DEVICE_ID}, ${weight}, CURRENT_TIMESTAMP)
            ON CONFLICT (device_id) 
            DO UPDATE SET weight = EXCLUDED.weight, last_seen = CURRENT_TIMESTAMP
        `;
    } catch (err) {
        console.error("DB Error (updateWeight):", err);
    }
}

async function updateDailyUsage(dailyUsage) {
    try {
        await sql`
            INSERT INTO device_state (device_id, daily_usage, last_seen)
            VALUES (${DEVICE_ID}, ${dailyUsage}, CURRENT_TIMESTAMP)
            ON CONFLICT (device_id) 
            DO UPDATE SET daily_usage = EXCLUDED.daily_usage, last_seen = CURRENT_TIMESTAMP
        `;
    } catch (err) {
        console.error("DB Error (updateDailyUsage):", err);
    }
}

// =======================================
// HISTORY
// =======================================

async function saveHistory(data) {
    try {
        await sql`
            INSERT INTO feed_history (device_id, amount, mode, timestamp)
            VALUES (${DEVICE_ID}, ${data.amount}, ${data.mode || 'manual'}, CURRENT_TIMESTAMP)
        `;
    } catch (err) {
        console.error("DB Error (saveHistory):", err);
    }
}

async function getHistory(limit = 100) {
    try {
        const { rows } = await sql`
            SELECT id, amount, mode, timestamp 
            FROM feed_history 
            WHERE device_id = ${DEVICE_ID} 
            ORDER BY timestamp DESC 
            LIMIT ${limit}
        `;
        return rows.map(row => ({
            id: String(row.id),
            amount: Number(row.amount),
            mode: row.mode,
            timestamp: row.timestamp
        }));
    } catch (err) {
        console.error("DB Error (getHistory):", err);
        return [];
    }
}

async function clearHistory() {
    try {
        await sql`DELETE FROM feed_history WHERE device_id = ${DEVICE_ID}`;
    } catch (err) {
        console.error("DB Error (clearHistory):", err);
    }
}

// =======================================
// ALERT
// =======================================

async function saveAlert(data) {
    try {
        await sql`
            INSERT INTO alerts (device_id, message, level, timestamp)
            VALUES (${DEVICE_ID}, ${data.message}, ${data.level || 'info'}, CURRENT_TIMESTAMP)
        `;
    } catch (err) {
        console.error("DB Error (saveAlert):", err);
    }
}

async function getAlerts(limit = 20) {
    try {
        const { rows } = await sql`
            SELECT id, message, level, timestamp 
            FROM alerts 
            WHERE device_id = ${DEVICE_ID} 
            ORDER BY timestamp DESC 
            LIMIT ${limit}
        `;
        return rows.map(row => ({
            id: String(row.id),
            message: row.message,
            level: row.level,
            timestamp: row.timestamp
        }));
    } catch (err) {
        console.error("DB Error (getAlerts):", err);
        return [];
    }
}

async function clearAlerts() {
    try {
        await sql`DELETE FROM alerts WHERE device_id = ${DEVICE_ID}`;
    } catch (err) {
        console.error("DB Error (clearAlerts):", err);
    }
}

// =======================================
// SCHEDULE
// =======================================

async function saveSchedules(schedules) {
    try {
        // Delete old schedules
        await sql`DELETE FROM schedules WHERE device_id = ${DEVICE_ID}`;

        // Insert new ones
        for (const item of schedules) {
            await sql`
                INSERT INTO schedules (device_id, time, amount, enable, created_at)
                VALUES (${DEVICE_ID}, ${item.time}, ${item.amount ?? 10}, ${item.enable ?? true}, CURRENT_TIMESTAMP)
            `;
        }
    } catch (err) {
        console.error("DB Error (saveSchedules):", err);
    }
}

async function getSchedules() {
    try {
        const { rows } = await sql`
            SELECT id, time, amount, enable, created_at 
            FROM schedules 
            WHERE device_id = ${DEVICE_ID} 
            ORDER BY time ASC
        `;
        return rows.map(row => ({
            id: String(row.id),
            time: row.time,
            amount: Number(row.amount),
            enable: row.enable,
            createdAt: row.created_at
        }));
    } catch (err) {
        console.error("DB Error (getSchedules):", err);
        return [];
    }
}

// =======================================
// EXPORT
// =======================================

module.exports = {
    updateDevice,
    getDevice,
    updateWeight,
    updateDailyUsage,
    saveHistory,
    getHistory,
    clearHistory,
    saveAlert,
    getAlerts,
    clearAlerts,
    saveSchedules,
    getSchedules
};