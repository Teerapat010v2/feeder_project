const { sql } = require("@vercel/postgres");

// Memory cache to prevent calling CREATE TABLE on every insert for every device
const createdTables = new Set();

async function ensureTableExists(deviceId) {
    if (createdTables.has(deviceId)) return;
    try {
        await sql.query(`
            CREATE TABLE IF NOT EXISTS "${deviceId}" (
                id SERIAL PRIMARY KEY,
                device_id VARCHAR(50) NOT NULL,
                amount NUMERIC NOT NULL,
                mode VARCHAR(20) DEFAULT 'manual',
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        createdTables.add(deviceId);
    } catch (err) {
        console.error("Failed to create table for", deviceId, ":", err);
    }
}

// Memory fallback for state, alerts, schedules per device
let deviceStates = {};
let memoryAlerts = {};
let memorySchedules = {};

async function updateDevice(deviceId, data) {
    if (!deviceStates[deviceId]) {
        deviceStates[deviceId] = {
            id: deviceId, online: false, feeding: false, weight: 0,
            foodLevel: 'green', dailyUsage: 100, firmware: "", ip: "", wifi: 0,
            lastSeen: new Date(), feedAmount: 10
        };
    }
    const state = deviceStates[deviceId];
    if (data.online !== undefined) state.online = data.online;
    if (data.feeding !== undefined) state.feeding = data.feeding;
    if (data.weight !== undefined) state.weight = data.weight;
    if (data.foodLevel !== undefined) state.foodLevel = data.foodLevel;
    if (data.dailyUsage !== undefined) state.dailyUsage = data.dailyUsage;
    if (data.firmware !== undefined) state.firmware = data.firmware;
    if (data.ip !== undefined) state.ip = data.ip;
    if (data.wifi !== undefined) state.wifi = data.wifi;
    if (data.feedAmount !== undefined) state.feedAmount = data.feedAmount;
    state.lastSeen = new Date();
}

async function getDevice(deviceId) {
    return deviceStates[deviceId] || null;
}

async function updateWeight(deviceId, weight) {
    if (!deviceStates[deviceId]) await updateDevice(deviceId, {});
    deviceStates[deviceId].weight = weight;
    deviceStates[deviceId].lastSeen = new Date();
}

async function updateDailyUsage(deviceId, dailyUsage) {
    if (!deviceStates[deviceId]) await updateDevice(deviceId, {});
    deviceStates[deviceId].dailyUsage = dailyUsage;
    deviceStates[deviceId].lastSeen = new Date();
}

async function saveHistory(deviceId, data) {
    try {
        await ensureTableExists(deviceId);
        await sql.query(`
            INSERT INTO "${deviceId}" (device_id, amount, mode, timestamp)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        `, [deviceId, data.amount, data.mode || 'manual']);
    } catch (err) {
        console.error("DB Error (saveHistory):", err);
    }
}

async function getHistory(deviceId, limit = 100) {
    try {
        await ensureTableExists(deviceId);
        const { rows } = await sql.query(`
            SELECT id, amount, mode, timestamp 
            FROM "${deviceId}"
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

async function clearHistory(deviceId) {
    try {
        await ensureTableExists(deviceId);
        await sql.query(`DELETE FROM "${deviceId}"`);
    } catch (err) {
        console.error("DB Error (clearHistory):", err);
    }
}

async function saveAlert(deviceId, data) {
    if (!memoryAlerts[deviceId]) memoryAlerts[deviceId] = [];
    memoryAlerts[deviceId].unshift({
        id: String(Date.now()),
        message: data.message,
        level: data.level || 'info',
        timestamp: new Date()
    });
    if (memoryAlerts[deviceId].length > 50) memoryAlerts[deviceId].pop();
}

async function getAlerts(deviceId, limit = 20) {
    return (memoryAlerts[deviceId] || []).slice(0, limit);
}

async function clearAlerts(deviceId) {
    memoryAlerts[deviceId] = [];
}

async function saveSchedules(deviceId, schedules) {
    memorySchedules[deviceId] = schedules.map((item, index) => ({
        id: String(index),
        time: item.time,
        amount: Number(item.amount ?? 10),
        enable: item.enable ?? true,
        createdAt: new Date()
    }));
}

async function getSchedules(deviceId) {
    return memorySchedules[deviceId] || [];
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