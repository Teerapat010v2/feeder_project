require("dotenv").config();
const mqtt = require("mqtt");
const database = require("./database");
const { calculateFoodStatus } = require("./foodStatus");

let io = null;

if (!process.env.MQTT_HOST || !process.env.MQTT_PORT) {
    console.warn("[MQTT] MQTT_HOST / MQTT_PORT ไม่ได้ถูกตั้งค่าใน .env — MQTT จะเชื่อมต่อไม่ได้");
}

const client = mqtt.connect("mqtts://97a545ab69f44dde939442a2b857bc3b.s1.eu.hivemq.cloud:8883", {
    username: "teerapat",
    password: "Teerapat99",
    clientId: "vercel-serverless-" + Math.random().toString(16).substr(2, 8),
    reconnectPeriod: 5000,
    connectTimeout: 10000,
    rejectUnauthorized: process.env.MQTT_REJECT_UNAUTHORIZED === "true"
});

// Wildcard topics to listen to ALL devices
const SUBSCRIBE_TOPICS = [
    `fishfeeder/+/status`,
    `fishfeeder/+/weight`,
    `fishfeeder/+/alert`,
    `fishfeeder/+/history`,
    `fishfeeder/+/schedule_update`
];

function start(socketio){
    io = socketio;
    client.on("connect",()=>{
        console.log("MQTT Connected");
        SUBSCRIBE_TOPICS.forEach(topic=>{
            client.subscribe(topic,(err)=>{
                if(err) console.log("Subscribe Error",topic);
                else console.log("Subscribed :",topic);
            });
        });
    });

    client.on("reconnect",()=>console.log("Reconnect MQTT..."));
    client.on("offline",()=>console.log("MQTT Offline"));
    client.on("close",()=>console.log("MQTT Closed"));
    client.on("error",(err)=>console.log(err.message));
    client.on("message", onMessage);
}

// Helper to extract deviceId and action from topic
// Example: fishfeeder/Prototype_02/history -> deviceId: Prototype_02, action: history
function parseTopic(topic) {
    const parts = topic.split("/");
    if (parts.length >= 3 && parts[0] === "fishfeeder") {
        return { deviceId: parts[1], action: parts[2] };
    }
    return null;
}

async function onMessage(topic, message) {
    try {
        const data = JSON.parse(message.toString());
        const parsed = parseTopic(topic);
        if (!parsed) return;
        
        const { deviceId, action } = parsed;
        console.log("MQTT >", topic, data);

        switch (action) {
            case "status":
                if (data.online === false) {
                    await database.updateDevice(deviceId, { online: false });
                    if (io) io.emit("status", { deviceId, online: false, feeding: false });
                } else {
                    await handleStatus(deviceId, data);
                }
                break;
            case "weight":
                await handleWeight(deviceId, data);
                break;
            case "alert":
                await handleAlert(deviceId, data);
                break;
            case "history":
                await handleHistory(deviceId, data);
                break;
            case "schedule_update":
                await handleScheduleUpdate(deviceId, data);
                break;
        }
    } catch (err) {
        console.log("[MQTT] Invalid payload on", topic, "-", err.message);
    }
}

async function handleStatus(deviceId, data) {
    try {
        const isOnline = data.online !== undefined ? data.online : true;
        await database.updateDevice(deviceId, {
            online: isOnline, feeding: data.feeding || false,
            firmware: data.firmware || "", ip: data.ip || "", wifi: data.wifi || 0
        });
        if (io) io.emit("status", { deviceId, online: isOnline, feeding: data.feeding || false, firmware: data.firmware, ip: data.ip, wifi: data.wifi });
    } catch (err) {
        console.log(err.message);
    }
}

async function handleWeight(deviceId, data) {
    try {
        await database.updateWeight(deviceId, data.weight);
        if (io) io.emit("weight", { deviceId, weight: data.weight });

        const device = await database.getDevice(deviceId);
        const dailyUsage = device?.dailyUsage || 100;
        const status = calculateFoodStatus(data.weight, dailyUsage);
        const previousLevel = device?.foodLevel;

        if (status.level !== "green" && status.level !== previousLevel) {
            const alert = {
                message: status.level === "red" ? \`อาหารวิกฤต เหลืออาหารใช้ได้อีกประมาณ \${status.daysRemaining} วัน\` : \`อาหารใกล้หมด เหลืออาหารใช้ได้อีกประมาณ \${status.daysRemaining} วัน\`,
                level: status.level === "red" ? "danger" : "warning"
            };
            await database.saveAlert(deviceId, alert);
            if (io) io.emit("alert", { deviceId, ...alert });
        }
        await database.updateDevice(deviceId, { foodLevel: status.level });
    } catch (err) {
        console.log(err.message);
    }
}

async function handleAlert(deviceId, data) {
    try {
        await database.saveAlert(deviceId, data);
        if (io) io.emit("alert", { deviceId, ...data });
    } catch (err) {
        console.log(err.message);
    }
}

async function handleHistory(deviceId, data) {
    try {
        let latestData = data;
        if (Array.isArray(data)) {
            if (data.length === 0) return;
            latestData = data[0];
        }
        const history = { amount: latestData.amount || 0, mode: latestData.mode || "manual" };
        await database.saveHistory(deviceId, history);
        const list = await database.getHistory(deviceId);
        if (io) io.emit("history", { deviceId, history: list });
    } catch (err) {
        console.log(err.message);
    }
}

async function handleScheduleUpdate(deviceId, data) {
    try {
        const schedulesArray = data.schedules || data;
        if (Array.isArray(schedulesArray)) {
            await database.saveSchedules(deviceId, schedulesArray);
            if (io) io.emit("schedule", { deviceId, schedules: schedulesArray });
            console.log("[MQTT] 🔄 Schedule updated from Local Mode:", schedulesArray.length, "items");
        }
    } catch (err) {
        console.log("[MQTT] Schedule Update Error:", err.message);
    }
}

// Helper to get deviceId from env if not provided (for backward compatibility on some API routes)
const DEFAULT_DEVICE_ID = process.env.DEVICE_ID || "Prototype_01";

async function feed(grams = 30, deviceId = DEFAULT_DEVICE_ID) {
    await publish(\`fishfeeder/\${deviceId}/cmd/command\`, { action: "FEED", amount: Number(grams), mode: "manual" });
}

async function stop(deviceId = DEFAULT_DEVICE_ID) {
    await publish(\`fishfeeder/\${deviceId}/cmd/command\`, { action: "EMERGENCY_STOP" });
}

async function schedule(schedules, deviceId = DEFAULT_DEVICE_ID) {
    try {
        await database.saveSchedules(deviceId, schedules);
        await publish(\`fishfeeder/\${deviceId}/schedule\`, { schedules }, true);
        if (io) io.emit("schedule", { deviceId, schedules });
    } catch (err) {
        console.log(err.message);
    }
}

async function sendCurrentState(socket, deviceId = DEFAULT_DEVICE_ID) {
    try {
        const device = await database.getDevice(deviceId);
        if (device) {
            socket.emit("status", device);
            socket.emit("weight", { weight: device.weight || 0 });
        }
        const history = await database.getHistory(deviceId);
        socket.emit("history", history);
        const alerts = await database.getAlerts(deviceId);
        socket.emit("alerts", alerts);
    } catch (err) {
        console.log(err.message);
    }
}

async function refreshDashboard(deviceId = DEFAULT_DEVICE_ID) {
    if (!io) return;
    try {
        const device = await database.getDevice(deviceId);
        if (device) {
            io.emit("status", device);
            io.emit("weight", { weight: device.weight || 0 });
        }
        const history = await database.getHistory(deviceId);
        io.emit("history", history);
        const alerts = await database.getAlerts(deviceId);
        io.emit("alerts", alerts);
    } catch (err) {
        console.log(err.message);
    }
}

function publish(topic, payload, retain = false) {
    return new Promise((resolve, reject) => {
        client.publish(topic, JSON.stringify(payload), { qos: 1, retain: retain }, (err) => {
            if (err) {
                console.log("Publish Error :", err.message);
                reject(err);
            } else {
                console.log("Publish >", topic);
                resolve();
            }
        });
    });
}

module.exports = {
    start, feed, stop, schedule, sendCurrentState, refreshDashboard, publish
};