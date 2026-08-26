const express = require("express");
const router = express.Router();

const mqtt = require("./mqtt");
const database = require("./database");
const { checkDeviceAuth } = require("./auth");

const MAX_FEED_GRAMS = 3000;
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_SCHEDULE_ROUNDS = 4;

router.get("/health", (req, res) => {
    res.json({ success: true, server: "Fish Feeder IoT v2", status: "Running", timestamp: new Date() });
});

router.post("/verify", checkDeviceAuth, (req, res) => {
    res.json({ success: true, message: "เข้าใช้งานสำเร็จ" });
});

router.use(checkDeviceAuth);

// Helper to get device ID from request
const getDeviceId = (req) => req.headers["x-device-id"] || process.env.DEVICE_ID || "Prototype_01";

router.get("/status", async (req, res) => {
    try {
        const deviceId = getDeviceId(req);
        const device = await database.getDevice(deviceId);
        res.json(device || { online: false, feeding: false, weight: 0, foodRemaining: 0, dailyUsage: 100 });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get("/history", async (req, res) => {
    try {
        const deviceId = getDeviceId(req);
        const history = await database.getHistory(deviceId);
        res.json(history);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get("/alerts", async (req, res) => {
    try {
        const deviceId = getDeviceId(req);
        const alerts = await database.getAlerts(deviceId);
        res.json(alerts);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get("/schedule", async (req, res) => {
    try {
        const deviceId = getDeviceId(req);
        const schedules = await database.getSchedules(deviceId);
        res.json(schedules);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post("/feed", async (req, res) => {
    try {
        const deviceId = getDeviceId(req);
        const grams = Number(req.body.grams);
        if (isNaN(grams) || grams <= 0) return res.status(400).json({ success: false, message: "Invalid grams value" });
        if (grams > MAX_FEED_GRAMS) return res.status(400).json({ success: false, message: \`Grams เกินขีดจำกัด (สูงสุด \${MAX_FEED_GRAMS} กรัมต่อครั้ง)\` });
        
        await mqtt.feed(grams, deviceId);
        res.json({ success: true, message: "Feed command sent." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post("/stop", async (req, res) => {
    try {
        const deviceId = getDeviceId(req);
        await mqtt.stop(deviceId);
        res.json({ success: true, message: "Stop command sent." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post("/settings/feed_amount", async (req, res) => {
    try {
        const deviceId = getDeviceId(req);
        const { feed_amount } = req.body;
        if (!feed_amount || isNaN(feed_amount) || feed_amount <= 0) {
            return res.status(400).json({ success: false, message: "Invalid feed_amount" });
        }
        await database.updateDevice(deviceId, { feedAmount: Number(feed_amount) });
        res.json({ success: true, message: "Feed amount saved." });
    } catch (err) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

router.post("/schedule", async (req, res) => {
    try {
        const deviceId = getDeviceId(req);
        const schedules = req.body.schedules;
        if (!Array.isArray(schedules)) return res.status(400).json({ success: false, message: "Schedule must be an array." });
        if (schedules.length > MAX_SCHEDULE_ROUNDS) return res.status(400).json({ success: false, message: \`ตั้งได้สูงสุด \${MAX_SCHEDULE_ROUNDS} รอบ/วัน\` });
        
        for (const item of schedules) {
            if (!item || typeof item.time !== "string" || !TIME_REGEX.test(item.time)) {
                return res.status(400).json({ success: false, message: \`รูปแบบเวลาไม่ถูกต้อง (ต้องเป็น HH:mm): \${item?.time}\` });
            }
            if (item.amount !== undefined && (isNaN(Number(item.amount)) || Number(item.amount) <= 0 || Number(item.amount) > MAX_FEED_GRAMS)) {
                return res.status(400).json({ success: false, message: \`ปริมาณอาหารไม่ถูกต้อง (1-\${MAX_FEED_GRAMS} กรัม): \${item?.amount}\` });
            }
        }
        await mqtt.schedule(schedules, deviceId);
        res.json({ success: true, message: "Schedule updated." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post("/usage", async (req, res) => {
    try {
        const deviceId = getDeviceId(req);
        const dailyUsage = Number(req.body.dailyUsage);
        if (isNaN(dailyUsage) || dailyUsage <= 0) return res.status(400).json({ success: false, message: "Invalid daily usage value" });
        await database.updateDailyUsage(deviceId, dailyUsage);
        await mqtt.refreshDashboard(deviceId);
        res.json({ success: true, message: "Daily usage updated." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.post("/refresh", async (req, res) => {
    try {
        const deviceId = getDeviceId(req);
        await mqtt.refreshDashboard(deviceId);
        res.json({ success: true, message: "Dashboard refreshed." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete("/history", async (req, res) => {
    try {
        const deviceId = getDeviceId(req);
        await database.clearHistory(deviceId);
        await mqtt.refreshDashboard(deviceId);
        res.json({ success: true, message: "History cleared." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.delete("/alerts", async (req, res) => {
    try {
        const deviceId = getDeviceId(req);
        await database.clearAlerts(deviceId);
        await mqtt.refreshDashboard(deviceId);
        res.json({ success: true, message: "Alerts cleared." });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;