# ⚠️ รายงานปัญหาที่ต้องระวัง (Warnings)

> ⚠️ **ยังไม่มีการแก้ไขโค้ด** — เป็นรายงานการตรวจสอบเท่านั้น

---

## ⚠️ ปัญหาที่อาจทำให้ระบบทำงานผิดพลาดในบางสถานการณ์

---

### [WARN-01] MQTT บน Vercel Server ใช้การเชื่อมต่อถาวร — ไม่เหมาะกับ Serverless

**ระดับ**: 🟠 MEDIUM-HIGH  
**ไฟล์**: [`mqtt.js`](file:///d:/project/feeder_project/server/mqtt.js) — บรรทัด 17-26

**ปัญหา**: 
```js
// mqtt.js - สร้าง MQTT client ตอน module load
const client = mqtt.connect("mqtts://...", {
    reconnectPeriod: 5000,  // ← พยายาม reconnect ทุก 5 วินาที
    connectTimeout: 10000,
});
```

Vercel Serverless ไม่รองรับ long-running connection ทุก function call จะ cold-start ใหม่ แต่โปรเจคนี้ deploy บน **Render** ซึ่งรองรับ → ไม่เป็นปัญหาบน Render แต่ถ้าย้ายไป Vercel จะพัง

**หมายเหตุ**: ส่วน `cron.js`, `history.js`, `schedule.js` อยู่ใน `/data/api/` ไม่ใช่ `/api/` จริงๆ → อาจเป็น Vercel Serverless ที่แยกออกมา ต้องตรวจสอบการ deploy ว่าถูกต้องไหม

---

### [WARN-02] MQTT ของ ESP32 ส่งสถานะทุก 1 วินาที — อาจโหลด HiveMQ Cloud มากเกินไป

**ระดับ**: 🟡 LOW-MEDIUM  
**ไฟล์**: [`fish_feeder.ino`](file:///d:/project/feeder_project/esp32/fish_feeder/fish_feeder.ino) — บรรทัด 495-499

**ปัญหา**:
```cpp
if (millis() - lastMqttPublish >= 1000) {  // ทุก 1 วินาที
    publishMQTTStatus();  // ← Publish ทุกครั้งแม้ค่าไม่เปลี่ยน
}
```

HiveMQ Cloud (Free Tier) มี limit บน Messages/month และ Connections ถ้าส่งทุก 1 วินาที ≈ 86,400 messages/วัน ≈ 2.6M messages/เดือน → อาจเกิน Free Tier

---

### [WARN-03] ระบบ Cron ทำงานซ้ำซ้อนกับ ESP32

**ระดับ**: 🟡 MEDIUM  
**ไฟล์**: [`cron.js`](file:///d:/project/feeder_project/esp32/fish_feeder/data/api/cron.js)  
**ไฟล์**: [`fish_feeder.ino`](file:///d:/project/feeder_project/esp32/fish_feeder/fish_feeder.ino) — `checkSchedules()`

**ปัญหา**: มีระบบ Schedule 2 ชั้น:
1. **ESP32** ตรวจเวลา NTP แล้ว triggerFeeding เอง
2. **Vercel Cron** ส่งคำสั่ง FEED ผ่าน MQTT ทุกนาที

ถ้าทั้ง 2 ระบบทำงานพร้อมกัน → ESP32 อาจให้อาหาร 2 ครั้งในเวลาเดียวกัน

---

### [WARN-04] MQTT ที่ Cron ใช้คนละ Broker กับที่ ESP32 ใช้

**ระดับ**: 🔴 HIGH  
**ไฟล์**: [`cron.js`](file:///d:/project/feeder_project/esp32/fish_feeder/data/api/cron.js) — บรรทัด 35  
**ไฟล์**: [`app.js`](file:///d:/project/feeder_project/esp32/fish_feeder/data/app.js) — บรรทัด 10  
**ไฟล์**: [`secrets.h`](file:///d:/project/feeder_project/esp32/fish_feeder/secrets.h)

**ปัญหา**:
```js
// cron.js ใช้
host: "e7343e0d8fa04b38bc8614522fb09796.s1.eu.hivemq.cloud"
username: "feeder_admin"

// app.js และ ESP32 ใช้
host: "97a545ab69f44dde939442a2b857bc3b.s1.eu.hivemq.cloud"
username: "teerapat"
```

**Broker คนละตัวกัน!** Cron จะ publish ไปยัง Broker ที่ ESP32 ไม่ได้ subscribe → Schedule จาก Cron จะไม่ถึง ESP32 เลย

---

### [WARN-05] `handleFileRead()` ตั้ง Cache-Control = 1 วัน — แก้ไขโค้ดยากระหว่าง Dev

**ระดับ**: 🟡 LOW-MEDIUM  
**ไฟล์**: [`fish_feeder.ino`](file:///d:/project/feeder_project/esp32/fish_feeder/fish_feeder.ino) — บรรทัด 264

**ปัญหา**:
```cpp
server.sendHeader("Cache-Control", "max-age=86400");  // cache 1 วัน
```

ถ้า update `app.js` หรือ `style.css` ใหม่และ OTA ลงบอร์ดแล้ว เบราว์เซอร์ผู้ใช้จะยังเห็นไฟล์เก่าอยู่อีก 1 วัน นั่นคือสาเหตุที่ต้องมีการต่อ `?v=2.97` ทุกครั้ง แต่ก็ยังไม่ครบทุกไฟล์

---

### [WARN-06] `server.js` เสิร์ฟจาก `/web` แต่ไม่มีโฟลเดอร์ `/web`

**ระดับ**: 🔴 HIGH  
**ไฟล์**: [`server.js`](file:///d:/project/feeder_project/server/server.js) — บรรทัด 47

**ปัญหา**:
```js
app.use(express.static(path.join(__dirname, "../web")));
```

ในโปรเจคไม่มีโฟลเดอร์ `web/` เลย (ไฟล์เว็บอยู่ที่ `esp32/fish_feeder/data/`) ระบบ Backend (Render) จะ serve static file ไม่ได้เลย รวมถึง `app.get("/")` จะส่งไฟล์ `web/index.html` ที่ไม่มีอยู่จริง

---

### [WARN-07] `handleScanWifi()` บล็อค Loop ในระหว่าง Scan WiFi

**ระดับ**: 🟠 MEDIUM  
**ไฟล์**: [`fish_feeder.ino`](file:///d:/project/feeder_project/esp32/fish_feeder/fish_feeder.ino) — บรรทัด 749-759

**ปัญหา**: `WiFi.scanNetworks()` เป็น blocking call ที่ใช้เวลา 2-5 วินาที ระหว่างนั้น Web Server จะไม่ตอบสนอง ควรใช้ `WiFi.scanNetworksAsync()`

---

### [WARN-08] `saveCalibrationBtn` แสดง success แม้ว่าค่า feedAmount ว่างเปล่า

**ระดับ**: 🟡 LOW  
**ไฟล์**: [`app.js`](file:///d:/project/feeder_project/esp32/fish_feeder/data/app.js) — บรรทัด 1039-1041

**ปัญหา**:
```js
if (val && val > 0) {
    // บันทึกจริง
} else {
    alert("✅ บันทึกการตั้งค่าลงระบบเรียบร้อย"); // ← แสดง success ทั้งที่ไม่ได้บันทึก!
}
```

ผู้ใช้จะเห็น "✅ บันทึกสำเร็จ" แม้จะไม่ได้กรอกค่าอะไรเลย

---

### [WARN-09] `updateDevice()` — `lastSeen` ถูกส่งมาใน data แต่ไม่ถูก save

**ระดับ**: 🟡 LOW  
**ไฟล์**: [`database.js`](file:///d:/project/feeder_project/server/database.js) — บรรทัด 19-35

**ปัญหา**:
```js
// mqtt.js ส่ง lastSeen มา
await database.updateDevice({
    lastSeen: new Date(),  // ← ส่งมา
    ...
});

// database.js ไม่ได้ check data.lastSeen เลย
// setClauses จะไม่มี lastSeen → ใช้ CURRENT_TIMESTAMP แทน (เผอิญถูก)
```

ไม่ใช่บัคร้ายแรง แต่โค้ดสับสนว่าทำไมถึงส่ง `lastSeen` มาแต่ไม่ใช้

---

### [WARN-10] `app.js` มี DOMContentLoaded ซ้อนหลายชั้น — หาบัคยากมาก

**ระดับ**: 🟡 LOW  
**ไฟล์**: [`app.js`](file:///d:/project/feeder_project/esp32/fish_feeder/data/app.js)

**ปัญหา**: มี `document.addEventListener("DOMContentLoaded", ...)` อย่างน้อย **6 ชั้น** ที่แยกส่วนกัน:
1. Main Dashboard (หน้า index)
2. AP WiFi Settings
3. Sidebar Logic
4. Tab Navigation
5. Home WiFi Settings
6. Schedule Logic + History + Weight System รวมอยู่ในตัวเดียว

ทุก page โหลด `app.js` ตัวเดียวกัน แต่บาง event listener จะ null (element ไม่มีในหน้านั้น) ทำให้ debug ยากมาก และ performance ไม่ดี (โหลด code ที่ไม่ใช้)
