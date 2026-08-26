const { sql } = require("@vercel/postgres");

const DEVICE_ID = process.env.DEVICE_ID || "Prototype_01";

// Cache to prevent calling CREATE TABLE on every insert
let tableCreated = false;

async function ensureTableExists() {
    if (tableCreated) return;
    try {
        await sql.query(`
            CREATE TABLE IF NOT EXISTS "${DEVICE_ID}" (
                id SERIAL PRIMARY KEY,
                device_id VARCHAR(50) NOT NULL,
                amount NUMERIC NOT NULL,
                mode VARCHAR(20) DEFAULT 'manual',
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        tableCreated = true;
    } catch (err) {
        console.error("Failed to create table:", err);
    }
}

// Memory fallback for state, alerts, schedules
let deviceState = {
    id: DEVICE_ID,
    online: false,
    feeding: false,
    weight: 0,
    foodLevel: 'green',
    dailyUsage: 100,
    firmware: "",
    ip: "",
    wifi: 0,
    lastSeen: new Date(),
    feedAmount: 10
};
let memoryAlerts = [];
let memorySchedules = [];

async function updateDevice(data) {
    if (data.online !== undefined) deviceState.online = data.online;
    if (data.feeding !== undefined) deviceState.feeding = data.feeding;
    if (data.weight !== undefined) deviceState.weight = data.weight;
    if (data.foodLevel !== undefined) deviceState.foodLevel = data.foodLevel;
    if (data.dailyUsage !== undefined) deviceState.dailyUsage = data.dailyUsage;
    if (data.firmware !== undefined) deviceState.firmware = data.firmware;
    if (data.ip !== undefined) deviceState.ip = data.ip;
    if (data.wifi !== undefined) deviceState.wifi = data.wifi;
    if (data.feedAmount !== undefined) deviceState.feedAmount = data.feedAmount;
    deviceState.lastSeen = new Date();
}

async function getDevice() {
    return deviceState;
}

async function updateWeight(weight) {
    deviceState.weight = weight;
    deviceState.lastSeen = new Date();
}

async function updateDailyUsage(dailyUsage) {
    deviceState.dailyUsage = dailyUsage;
    deviceState.lastSeen = new Date();
}

async function saveHistory(data) {
    try {
        await ensureTableExists();
        await sql.query(`
            INSERT INTO "${DEVICE_ID}" (device_id, amount, mode, timestamp)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        `, [DEVICE_ID, data.amount, data.mode || 'manual']);
    } catch (err) {
        console.error("DB Error (saveHistory):", err);
    }
}

async function getHistory(limit = 100) {
    try {
        await ensureTableExists();
        const { rows } = await sql.query(`
            SELECT id, amount, mode, timestamp 
            FROM "${DEVICE_ID}"
            ORDER BY timestamp DESC 
            LIMIT $1
        `, [limit]);
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
        await ensureTableExists();
        await sql.query(`DELETE FROM "${DEVICE_ID}"`);
    } catch (err) {
        console.error("DB Error (clearHistory):", err);
    }
}

async function saveAlert(data) {
    memoryAlerts.unshift({
        id: String(Date.now()),
        message: data.message,
        level: data.level || 'info',
        timestamp: new Date()
    });
    if (memoryAlerts.length > 50) memoryAlerts.pop();
}

async function getAlerts(limit = 20) {
    return memoryAlerts.slice(0, limit);
}

async function clearAlerts() {
    memoryAlerts = [];
}

async function saveSchedules(schedules) {
    memorySchedules = schedules.map((item, index) => ({
        id: String(index),
        time: item.time,
        amount: Number(item.amount ?? 10),
        enable: item.enable ?? true,
        createdAt: new Date()
    }));
}

async function getSchedules() {
    return memorySchedules;
}

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