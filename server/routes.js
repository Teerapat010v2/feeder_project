const express = require("express");
const router = express.Router();

const mqtt = require("./mqtt");
const database = require("./database");
const { checkDeviceAuth } = require("./auth");

const MAX_FEED_GRAMS = 3000; // กันสั่งให้อาหารเกินขนาดถัง/มอเตอร์
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/; // HH:mm
const MAX_SCHEDULE_ROUNDS = 4; // ตาม README

// =======================================
// PUBLIC (ไม่ต้องใส่รหัส)
// =======================================

router.get("/health", (req, res) => {

    res.json({

        success: true,

        server: "Fish Feeder IoT v2",

        status: "Running",

        timestamp: new Date()

    });

});

// ใช้โดยหน้าเว็บตอนกรอก "ไอดีเครื่อง + รหัส" ครั้งแรก เพื่อเช็คว่าถูกไหม
router.post("/verify", checkDeviceAuth, (req, res) => {

    res.json({
        success: true,
        message: "เข้าใช้งานสำเร็จ"
    });

});

// =======================================
// ตั้งแต่จุดนี้ลงไป ต้องใส่ header
// x-device-id / x-device-code ให้ตรงกับ .env
// =======================================

router.use(checkDeviceAuth);

// =======================================
// GET DEVICE STATUS
// =======================================

router.get("/status", async (req, res) => {

    try {

        const device = await database.getDevice();

        res.json(device || {
            online: false,
            feeding: false,
            weight: 0,
            foodRemaining: 0,
            dailyUsage: 100
        });

    } catch (err) {

        res.status(500).json({
            success: false,
            message: err.message
        });

    }

});

// =======================================
// GET HISTORY
// =======================================

router.get("/history", async (req, res) => {

    try {

        const history = await database.getHistory();

        res.json(history);

    } catch (err) {

        res.status(500).json({
            success: false,
            message: err.message
        });

    }

});

// =======================================
// GET ALERTS
// =======================================

router.get("/alerts", async (req, res) => {

    try {

        const alerts = await database.getAlerts();

        res.json(alerts);

    } catch (err) {

        res.status(500).json({
            success: false,
            message: err.message
        });

    }

});

// =======================================
// GET SCHEDULE
// =======================================

router.get("/schedule", async (req, res) => {

    try {

        const schedules = await database.getSchedules();

        res.json(schedules);

    } catch (err) {

        res.status(500).json({
            success: false,
            message: err.message
        });

    }

});

// =======================================
// POST FEED
// =======================================

router.post("/feed", async (req, res) => {

    try {

        const grams = Number(req.body.grams);

        if (isNaN(grams) || grams <= 0) {

            return res.status(400).json({
                success: false,
                message: "Invalid grams value"
            });

        }

        if (grams > MAX_FEED_GRAMS) {

            return res.status(400).json({
                success: false,
                message: `Grams เกินขีดจำกัด (สูงสุด ${MAX_FEED_GRAMS} กรัมต่อครั้ง)`
            });

        }

        await mqtt.feed(grams);

        res.json({
            success: true,
            message: "Feed command sent."
        });

    } catch (err) {

        res.status(500).json({
            success: false,
            message: err.message
        });

    }

});

// =======================================
// POST STOP
// =======================================

router.post("/stop", async (req, res) => {

    await mqtt.stop();

    res.json({
        success: true,
        message: "Stop command sent."
    });

});

// =======================================
// POST SCHEDULE
// =======================================

router.post("/schedule", async (req, res) => {

    try {

        const schedules = req.body.schedules;

        if (!Array.isArray(schedules)) {

            return res.status(400).json({
                success: false,
                message: "Schedule must be an array."
            });

        }

        if (schedules.length > MAX_SCHEDULE_ROUNDS) {

            return res.status(400).json({
                success: false,
                message: `ตั้งได้สูงสุด ${MAX_SCHEDULE_ROUNDS} รอบ/วัน`
            });

        }

        for (const item of schedules) {

            if (!item || typeof item.time !== "string" || !TIME_REGEX.test(item.time)) {

                return res.status(400).json({
                    success: false,
                    message: `รูปแบบเวลาไม่ถูกต้อง (ต้องเป็น HH:mm): ${item?.time}`
                });

            }
            
            if (item.amount !== undefined && (isNaN(Number(item.amount)) || Number(item.amount) <= 0 || Number(item.amount) > MAX_FEED_GRAMS)) {
                return res.status(400).json({
                    success: false,
                    message: `ปริมาณอาหารไม่ถูกต้อง (1-${MAX_FEED_GRAMS} กรัม): ${item?.amount}`
                });
            }

        }

        await mqtt.schedule(schedules);

        res.json({
            success: true,
            message: "Schedule updated."
        });

    } catch (err) {

        res.status(500).json({
            success: false,
            message: err.message
        });

    }

});

// =======================================
// POST DAILY USAGE
// =======================================

router.post("/usage", async (req, res) => {

    try {

        const dailyUsage = Number(req.body.dailyUsage);

        if (isNaN(dailyUsage) || dailyUsage <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid daily usage value"
            });
        }

        await database.updateDailyUsage(dailyUsage);

        await mqtt.refreshDashboard();

        res.json({
            success: true,
            message: "Daily usage updated."
        });

    } catch (err) {

        res.status(500).json({
            success: false,
            message: err.message
        });

    }

});

// =======================================
// POST REFRESH
// =======================================

router.post("/refresh", async (req, res) => {

    try {

        await mqtt.refreshDashboard();

        res.json({
            success: true,
            message: "Dashboard refreshed."
        });

    } catch (err) {

        res.status(500).json({
            success: false,
            message: err.message
        });

    }

});

// =======================================
// DELETE HISTORY
// =======================================

router.delete("/history", async (req, res) => {

    try {

        await database.clearHistory();

        await mqtt.refreshDashboard();

        res.json({
            success: true,
            message: "History cleared."
        });

    } catch (err) {

        res.status(500).json({
            success: false,
            message: err.message
        });

    }

});

// =======================================
// DELETE ALERTS
// =======================================

router.delete("/alerts", async (req, res) => {

    try {

        await database.clearAlerts();

        await mqtt.refreshDashboard();

        res.json({
            success: true,
            message: "Alerts cleared."
        });

    } catch (err) {

        res.status(500).json({
            success: false,
            message: err.message
        });

    }

});

module.exports = router;