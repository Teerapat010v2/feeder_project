// =======================================
// DEVICE AUTH (ไม่มีระบบ Login/User)
// ตรวจแค่ "ไอดีเครื่อง" + "รหัสเข้าใช้งาน" จาก .env
// =======================================

function isConfigured() {
    return Boolean(process.env.DEVICE_ID && process.env.DEVICE_CODE);
}

function isValid(deviceId, deviceCode) {
    if (!isConfigured()) {
        // ยังไม่ตั้งค่าใน .env -> เตือนใน log แต่ไม่บล็อก (กันเผลอใช้งานไม่ได้ตอน dev)
        console.warn("[AUTH] DEVICE_ID / DEVICE_CODE ยังไม่ถูกตั้งค่าใน .env -> API ยังไม่ถูกป้องกัน!");
        return true;
    }

    return (
        deviceCode === process.env.DEVICE_CODE
    );
}

// ใช้กับ Express routes
function checkDeviceAuth(req, res, next) {

    const deviceId = req.headers["x-device-id"];
    const deviceCode = req.headers["x-device-code"];

    if (isValid(deviceId, deviceCode)) {
        return next();
    }

    return res.status(401).json({
        success: false,
        message: "ไอดีเครื่องหรือรหัสไม่ถูกต้อง"
    });

}

// ใช้กับ Socket.io handshake
function checkSocketAuth(socket) {

    const { deviceId, deviceCode } = socket.handshake.auth || {};

    return isValid(deviceId, deviceCode);

}

module.exports = {
    checkDeviceAuth,
    checkSocketAuth,
    isConfigured
};