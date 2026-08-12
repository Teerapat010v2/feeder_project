require("dotenv").config();

const mqtt = require("mqtt");
const database = require("./database");
const { calculateFoodStatus } = require("./foodStatus");

let io = null;

// ==========================
// MQTT CONFIG
// ==========================

if (!process.env.MQTT_HOST || !process.env.MQTT_PORT) {
    console.warn("[MQTT] MQTT_HOST / MQTT_PORT ไม่ได้ถูกตั้งค่าใน .env — MQTT จะเชื่อมต่อไม่ได้");
}

const client = mqtt.connect("mqtts://97a545ab69f44dde939442a2b857bc3b.s1.eu.hivemq.cloud:8883", {
    username: "teerapat",
    password: "Teerapat99",
    clientId: "vercel-serverless-" + Math.random().toString(16).substr(2, 8),
    reconnectPeriod: 5000,
    connectTimeout: 10000,
    // ค่าเดิมเป็น false เสมอ (ปิดการตรวจ cert) ซึ่งเสี่ยงต่อ MITM
    // ตั้ง MQTT_REJECT_UNAUTHORIZED=true ใน .env เมื่อ broker ใช้ cert ที่ถูกต้อง (เช่น HiveMQ Cloud)
    rejectUnauthorized: process.env.MQTT_REJECT_UNAUTHORIZED === "true"
});

// ==========================
// TOPICS
// ==========================

const DEVICE_ID = process.env.DEVICE_ID || "Prototype_01";

const TOPIC = {
    COMMAND: `fishfeeder/${DEVICE_ID}/cmd/command`,   // Server -> Device
    STATUS: `fishfeeder/${DEVICE_ID}/status`,         // Device -> Server
    WEIGHT: `fishfeeder/${DEVICE_ID}/weight`,         // Device -> Server
    ALERT: `fishfeeder/${DEVICE_ID}/alert`,           // Device -> Server
    HISTORY: `fishfeeder/${DEVICE_ID}/history`,       // Device -> Server
    SCHEDULE: `fishfeeder/${DEVICE_ID}/schedule`      // Server -> Device
};

// เดิม subscribe ทุก topic รวมถึง COMMAND/SCHEDULE ที่ตัวเอง publish เอง (ฟัง echo ตัวเองโดยเปล่าประโยชน์)
// แก้เป็น subscribe เฉพาะ topic ที่ "อุปกรณ์" เป็นผู้ส่งเข้ามาเท่านั้น
const SUBSCRIBE_TOPICS = [
    TOPIC.STATUS,
    TOPIC.WEIGHT,
    TOPIC.ALERT,
    TOPIC.HISTORY
];

// ==========================
// START
// ==========================

function start(socketio){

    io = socketio;

    client.on("connect",()=>{

        console.log("");

        console.log("========================");

        console.log("MQTT Connected");

        console.log("========================");

        SUBSCRIBE_TOPICS.forEach(topic=>{

            client.subscribe(topic,(err)=>{

                if(err){

                    console.log("Subscribe Error",topic);

                }else{

                    console.log("Subscribed :",topic);

                }

            });

        });

    });

    client.on("reconnect",()=>{

        console.log("Reconnect MQTT...");

    });

    client.on("offline",()=>{

        console.log("MQTT Offline");

        // อุปกรณ์อาจไม่ online จริง แต่บอกได้แค่ว่า "server เชื่อม broker ไม่ได้"
        // ควรพึ่ง MQTT Last-Will-Testament (LWT) จากฝั่ง ESP8266 เพื่อบอกสถานะ online จริง ๆ

    });

    client.on("close",()=>{

        console.log("MQTT Closed");

    });

    client.on("error",(err)=>{

        console.log(err.message);

    });

    client.on("message",onMessage);

}

// ==========================
// RECEIVE MQTT (ฉบับปรับปรุง ดักจับสถานะ Offline เมื่อถอดสายไฟ)
// ==========================

async function onMessage(topic, message) {

    try {

        const data = JSON.parse(message.toString());

        console.log("MQTT >", topic, data);

        switch (topic) {

            case TOPIC.STATUS:

                // ตรวจสอบว่าบอร์ดส่งสถานะหลุด (Last Will) มาหรือไม่
                if (data.online === false) {

                    await database.updateDevice({ online: false });

                    if (io) {
                        io.emit("status", { online: false, feeding: false });
                    }
                    console.log("[STATUS] Device went OFFLINE via Last Will.");

                } else {

                    await handleStatus(data);

                }

            break;

            case TOPIC.WEIGHT:
                await handleWeight(data);
            break;

            case TOPIC.ALERT:
                await handleAlert(data);
            break;

            case TOPIC.HISTORY:
                await handleHistory(data);
            break;

        }

    }

    catch (err) {
        console.log("[MQTT] Invalid payload on", topic, "-", err.message);
    }

}
// ==========================
// HANDLE STATUS
// ==========================

async function handleStatus(data) {

    try {

        const isOnline = data.online !== undefined ? data.online : true;

        await database.updateDevice({
            online: isOnline,
            feeding: data.feeding || false,
            lastSeen: new Date(),
            firmware: data.firmware || "",
            ip: data.ip || "",
            wifi: data.wifi || 0
        });

        if (io) {
            io.emit("status", {
                online: isOnline,
                feeding: data.feeding || false,
                firmware: data.firmware,
                ip: data.ip,
                wifi: data.wifi
            });
        }

    } catch (err) {

        console.log(err.message);

    }

}

// ==========================
// HANDLE WEIGHT
// ==========================
// เดิม: ทุกครั้งที่ได้ค่าน้ำหนัก <= 500g จะสร้าง Alert ใหม่ทุกครั้ง (ถ้า ESP8266
// ส่งค่าน้ำหนักทุก ๆ ไม่กี่วินาที จะเกิด Alert document สแปมเข้า Firestore รัว ๆ)
// แก้ไข: ใช้ foodStatus.js (เดิมมีไฟล์นี้แต่ backend ไม่เคยเรียกใช้เลย) คำนวณ
// ระดับสถานะ แล้วแจ้งเตือนเฉพาะตอน "ระดับเปลี่ยน" เท่านั้น (green -> yellow -> red)

async function handleWeight(data) {

    try {

        await database.updateWeight(data.weight);

        if (io) {

            io.emit("weight", {

                weight: data.weight

            });

        }

        const device = await database.getDevice();
        const dailyUsage = device?.dailyUsage || 100;
        const status = calculateFoodStatus(data.weight, dailyUsage);
        const previousLevel = device?.foodLevel;

        if (status.level !== "green" && status.level !== previousLevel) {

            const alert = {

                message: status.level === "red"
                    ? `อาหารวิกฤต เหลืออาหารใช้ได้อีกประมาณ ${status.daysRemaining} วัน`
                    : `อาหารใกล้หมด เหลืออาหารใช้ได้อีกประมาณ ${status.daysRemaining} วัน`,

                level: status.level === "red" ? "danger" : "warning"

            };

            await database.saveAlert(alert);

            if (io) {

                io.emit("alert", alert);

            }

        }

        // เก็บระดับล่าสุดไว้เทียบรอบถัดไป (กันแจ้งเตือนซ้ำ)
        await database.updateDevice({ foodLevel: status.level });

    } catch (err) {

        console.log(err.message);

    }

}

// ==========================
// HANDLE ALERT
// ==========================

async function handleAlert(data) {

    try {

        await database.saveAlert(data);

        if (io) {

            io.emit("alert", data);

        }

    } catch (err) {

        console.log(err.message);

    }

}

// ==========================
// HANDLE HISTORY
// ==========================

async function handleHistory(data) {

    try {

        const history = {

            amount: data.amount || 0,

            mode: data.mode || "manual"

        };

        await database.saveHistory(history);

        const list = await database.getHistory();

        if (io) {

            io.emit("history", list);

        }

    } catch (err) {

        console.log(err.message);

    }

}
// ==========================
// FEED COMMAND
// ==========================

async function feed(grams = 30) {
    await publish(TOPIC.COMMAND, {
        action: "FEED",
        amount: Number(grams),
        mode: "manual"
    });
}

// ==========================
// STOP COMMAND
// ==========================

async function stop() {
    await publish(TOPIC.COMMAND, {
        action: "EMERGENCY_STOP"
    });
}

// ==========================
// SAVE SCHEDULE
// ==========================

async function schedule(schedules) {

    try {

        await database.saveSchedules(schedules);

        await publish(TOPIC.SCHEDULE, {
            schedules
        }, true);

        if (io) {

            io.emit("schedule", schedules);

        }

    } catch (err) {

        console.log(err.message);

    }

}

// ==========================
// SEND CURRENT STATE
// ==========================

async function sendCurrentState(socket) {

    try {

        const device = await database.getDevice();

        if (device) {

            socket.emit("status", device);

            socket.emit("weight", {

                weight: device.weight || 0

            });

        }

        const history = await database.getHistory();

        socket.emit("history", history);

        const alerts = await database.getAlerts();

        socket.emit("alerts", alerts);

    } catch (err) {

        console.log(err.message);

    }

}

// ==========================
// REFRESH DASHBOARD
// ==========================

async function refreshDashboard() {

    if (!io) return;

    try {

        const device = await database.getDevice();

        if (device) {

            io.emit("status", device);

            io.emit("weight", {

                weight: device.weight || 0

            });

        }

        const history = await database.getHistory();

        io.emit("history", history);

        const alerts = await database.getAlerts();

        io.emit("alerts", alerts);

    } catch (err) {

        console.log(err.message);

    }

}

// ==========================
// MQTT PUBLISH
// ==========================

function publish(topic, payload, retain = false) {
    return new Promise((resolve, reject) => {
        client.publish(
            topic,
            JSON.stringify(payload),
            {
                qos: 1,
                retain: retain
            },
            (err) => {
                if (err) {
                    console.log("Publish Error :", err.message);
                    reject(err);
                } else {
                    console.log("Publish >", topic);
                    resolve();
                }
            }
        );
    });
}

// END PUBLISH

// ==========================
// EXPORT
// ==========================

module.exports = {

    start,

    feed,

    stop,

    schedule,

    sendCurrentState,

    refreshDashboard,

    publish,

    TOPIC

};