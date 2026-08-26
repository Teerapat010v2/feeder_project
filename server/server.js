require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const mqttService = require("./mqtt");
const routes = require("./routes");
const { checkSocketAuth, isConfigured } = require("./auth");

const app = express();

const server = http.createServer(app);

// เดิม origin: "*" (รับ request จากทุกที่) — แนะนำจำกัดด้วย FRONTEND_URL ใน .env
// ถ้าไม่ได้ตั้งค่า จะ fallback เป็น "*" เหมือนเดิมเพื่อไม่ให้ dev พังทันที
const io = new Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL || "*"
    }
});

const PORT = process.env.PORT || 3000;

if (!isConfigured()) {
    console.warn("");
    console.warn("⚠️  DEVICE_ID / DEVICE_CODE ยังไม่ได้ตั้งค่าใน .env");
    console.warn("⚠️  ตอนนี้ทุกคนที่เข้าเว็บ/เรียก API ได้จะสั่งงานเครื่องได้โดยไม่ต้องใส่รหัส");
    console.warn("");
}

//========================
// Middleware
//========================

app.use(express.json());

app.use(express.urlencoded({
    extended: true
}));

//========================
// Static Website
//========================

app.use(express.static(path.join(__dirname, "../web")));

//========================
// Socket.IO Auth
// ตรวจ deviceId/deviceCode ที่ client ส่งมาตอน connect (io({ auth: {...} }))
//========================

io.use((socket, next) => {

    if (checkSocketAuth(socket)) {
        return next();
    }

    next(new Error("Unauthorized: ไอดีเครื่อง/รหัสไม่ถูกต้อง"));

});

//========================
// Socket.IO
//========================

app.set("io", io);

//========================
// API
//========================

app.use("/api", routes);

//========================
// หน้าเว็บหลัก
//========================

app.get("/", (req, res) => {

    res.sendFile(
        path.join(__dirname, "../web/index.html")
    );

});

//========================
// Socket Connect
//========================

io.on("connection", async (socket) => {

    console.log("Client :", socket.id);

    socket.emit("connected", {
        success: true
    });

    const deviceId = socket.handshake.auth?.deviceId || process.env.DEVICE_ID || "Prototype_01";
    await mqttService.sendCurrentState(socket, deviceId);

    socket.on("disconnect", () => {

        console.log("Disconnect :", socket.id);

    });

});

io.on("connect_error", (err) => {
    console.log("Socket connect_error:", err.message);
});

//========================
// MQTT
//========================

mqttService.start(io);

//========================
// 404
//========================

app.use((req, res) => {

    res.status(404).json({

        success: false,

        message: "API Not Found"

    });

});

//========================
// Start
//========================

server.listen(PORT, () => {

    console.log("");
    console.log("=========================");
    console.log("Fish Feeder IoT v2");
    console.log("=========================");
    console.log("PORT :", PORT);
    console.log("=========================");

});