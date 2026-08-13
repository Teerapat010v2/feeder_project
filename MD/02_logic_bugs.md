# 🐛 รายงานบัคและความผิดพลาดทางตรรกะ (Logic Bugs)

> ⚠️ **ยังไม่มีการแก้ไขโค้ด** — เป็นรายงานการตรวจสอบเท่านั้น

---

## 🐛 บัคที่ทำให้ระบบทำงานผิดพลาด

---

### [BUG-01] Online Mode — ประวัติบันทึกก่อนอาหารออกจริง

**ระดับ**: 🔴 HIGH  
**ไฟล์**: [`app.js`](file:///d:/project/feeder_project/esp32/fish_feeder/data/app.js) — บรรทัด 283-297

**ปัญหา**: เมื่อกดปุ่ม "ให้อาหาร" ในโหมด Online ระบบจะ:
1. ส่งคำสั่ง MQTT ไปยัง ESP32
2. **บันทึก history ลง Database ทันทีโดยไม่รอผล**
3. ESP32 อาจไม่ได้รับคำสั่ง หรืออาหารไม่ออกจริง

```js
// app.js - Online Mode feed logic
mqttClient.publish(TOPIC_CMD, cmdPayload);  // ส่งคำสั่ง

// บันทึกลง DB ทันทีโดยไม่รอให้อาหารออกจริง!
await fetch('/api/history', {
    method: 'POST',
    body: JSON.stringify({ amount: amount, mode: 'manual' })
});
```

**ผลเสีย**: ประวัติจะมีข้อมูลที่ไม่ตรงกับความเป็นจริง (เคยบอกว่า "เราเน้นความแม่นยำ") ส่วน Local Mode ถูกแก้ให้ ESP32 วัดน้ำหนักจริงก่อนบันทึก แต่ Online Mode ยังมีปัญหานี้อยู่

---

### [BUG-02] การตรวจสอบโหมด Local/Online มีจุดบอด — `localhost`

**ระดับ**: 🔴 HIGH  
**ไฟล์**: [`app.js`](file:///d:/project/feeder_project/esp32/fish_feeder/data/app.js) — บรรทัด 7

**ปัญหา**:
```js
window.isLocalMode = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(
    window.location.hostname
);
```

ตรวจจาก IP Pattern เท่านั้น แต่ **ไม่ตรวจ `localhost`** ถ้ากำลัง dev และเปิดเว็บบน `localhost` จะได้ `isLocalMode = false` → เว็บจะพยายามเชื่อมต่อ HiveMQ แทน → ปุ่มต่างๆ จะส่งคำสั่ง MQTT ที่อาจไม่ถึง ESP32 Dev

---

### [BUG-03] `handleApiStatus()` — ตรรกะแสดงโหมดผิด

**ระดับ**: 🟠 MEDIUM  
**ไฟล์**: [`fish_feeder.ino`](file:///d:/project/feeder_project/esp32/fish_feeder/fish_feeder.ino) — บรรทัด 591-612

**ปัญหา**: ใน `handleApiStatus()` โค้ดกำหนดโหมดโดยดูจาก Schedule ว่ามี enable อยู่ไหม แทนที่จะดู `forceManualMode`:
```cpp
// ผิด: ดูแค่ว่ามี Schedule enable ไหม
String currentMode = "MANUAL";
for (int i = 0; i < scheduleCount; i++) {
    if (localSchedules[i].enable) {
        currentMode = "AUTO";
        break;
    }
}
```

แต่ใน `publishMQTTStatus()` ใช้วิธีที่ถูกต้อง:
```cpp
// ถูก: ดู forceManualMode โดยตรง
String currentMode = forceManualMode ? "MANUAL" : "AUTO";
```

**ผลเสีย**: หน้าเว็บในโหมด Local จะแสดงสถานะโหมดผิด ถ้าผู้ใช้บังคับ Manual แต่ยังมี Schedule enable อยู่ เว็บจะแสดง AUTO ทั้งที่ระบบเป็น MANUAL จริงๆ

---

### [BUG-04] `connectMQTT()` บน ESP32 ใช้ `while` loop บล็อค Loop หลัก

**ระดับ**: 🟠 MEDIUM  
**ไฟล์**: [`fish_feeder.ino`](file:///d:/project/feeder_project/esp32/fish_feeder/fish_feeder.ino) — บรรทัด 166-190

**ปัญหา**:
```cpp
void connectMQTT() {
    while (!mqttClient.connected()) {  // ← บล็อก Loop ทุกอย่าง
        if (mqttClient.connect(...)) {
            // ...
        } else {
            delay(5000);  // ← หยุดระบบทั้งหมด 5 วินาที
        }
    }
}
```

ระหว่างที่ MQTT กำลัง Reconnect เป็นเวลา 5 วินาที:
- `server.handleClient()` ไม่ทำงาน → Web API ทุกตัวค้าง
- `dnsServer.processNextRequest()` ไม่ทำงาน
- Schedule check ไม่ทำงาน
- ปุ่มหน้าเว็บทุกปุ่มจะไม่ตอบสนอง

---

### [BUG-05] `saveSchedules()` ใน database.js ไม่มี Transaction — ข้อมูลอาจสูญหาย

**ระดับ**: 🟠 MEDIUM  
**ไฟล์**: [`database.js`](file:///d:/project/feeder_project/server/database.js) — บรรทัด 189-203

**ปัญหา**:
```js
async function saveSchedules(schedules) {
    await sql`DELETE FROM schedules WHERE device_id = ${DEVICE_ID}`;  // ลบก่อน
    
    for (const item of schedules) {
        await sql`INSERT INTO schedules ...`;  // ถ้า Insert ตัวใดตัวหนึ่งล้มเหลว...
        // ← ข้อมูลเก่าโดนลบไปแล้ว แต่ข้อมูลใหม่ไม่ครบ!
    }
}
```

ถ้า Insert ตัวใดตัวหนึ่งล้มเหลวกลางทาง ข้อมูลเก่าที่ลบไปแล้วจะหายหมด และข้อมูลใหม่ก็ไม่ครบ

---

### [BUG-06] `updateDevice()` ใน database.js ใช้ String Interpolation แทน Parameterized Query

**ระดับ**: 🔴 HIGH  
**ไฟล์**: [`database.js`](file:///d:/project/feeder_project/server/database.js) — บรรทัด 19-32

**ปัญหา**:
```js
// การสร้าง SQL แบบนี้เสี่ยง SQL Injection
const setClauses = [];
if (data.firmware !== undefined) setClauses.push(`firmware = '${data.firmware}'`);
if (data.ip !== undefined) setClauses.push(`ip = '${data.ip}'`);

await sql.query(`UPDATE device_state SET ${setClauses.join(', ')} WHERE device_id = $1`, [DEVICE_ID]);
```

ค่า `firmware` และ `ip` ถูกนำมาต่อ String โดยตรง ไม่ผ่าน Parameterized Query แม้จะมาจาก MQTT แต่ถ้า Broker ถูก hijack ก็อันตราย

---

### [BUG-07] `schedules.js` (Vercel) — ไม่มีการ Validate ข้อมูล Schedule ก่อน Insert

**ระดับ**: 🟠 MEDIUM  
**ไฟล์**: [`schedule.js`](file:///d:/project/feeder_project/esp32/fish_feeder/data/api/schedule.js) — บรรทัด 30-52

**ปัญหา**: มีแค่ตรวจว่าเป็น Array แต่ไม่ validate ว่า:
- `time` อยู่ในรูปแบบ `HH:mm` ไหม
- `amount` อยู่ใน range ที่ถูกต้องไหม
- schedule เกิน 4 รอบไหม

ทำให้ข้อมูลขยะสามารถบันทึกลงฐานข้อมูลได้

---

### [BUG-08] `initDB.js` — Schema ของ `schedules` ไม่มีคอลัมน์ `amount`

**ระดับ**: 🟠 MEDIUM  
**ไฟล์**: [`initDB.js`](file:///d:/project/feeder_project/server/initDB.js) — บรรทัด 48-56

**ปัญหา**: Schema ใน `initDB.js` สำหรับตาราง `schedules` ไม่มี column `amount`:
```js
// initDB.js — ขาด amount column!
await sql`
    CREATE TABLE IF NOT EXISTS schedules (
        id SERIAL PRIMARY KEY,
        device_id VARCHAR(50) NOT NULL,
        time VARCHAR(5) NOT NULL,
        enable BOOLEAN DEFAULT true,  ← ไม่มี amount!
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
`;
```

แต่ `schema.sql` และ code จริงๆ ใช้ `amount` ทุกที่ → ถ้าใครรัน `initDB.js` สร้าง Table ใหม่ จะเกิด Error ทันทีที่ Insert Schedule

---

### [BUG-09] ซ้ำกัน 2 บรรทัดใน ESP32 — Route `/local-feed` ลงทะเบียน 2 ครั้ง

**ระดับ**: 🟡 LOW  
**ไฟล์**: [`fish_feeder.ino`](file:///d:/project/feeder_project/esp32/fish_feeder/fish_feeder.ino) — บรรทัด 371-372

**ปัญหา**:
```cpp
server.on("/local-feed", handleLocalFeed);           // ลงทะเบียนครั้งที่ 1
server.on("/local-feed", HTTP_GET, handleLocalFeed); // ลงทะเบียนครั้งที่ 2 (ซ้ำ)
```

---

### [BUG-10] `handleLocalStop()` เรียก `stopFeeding()` แล้ว `stopFeeding()` มี `delay(1000)`

**ระดับ**: 🟡 LOW  
**ไฟล์**: [`fish_feeder.ino`](file:///d:/project/feeder_project/esp32/fish_feeder/fish_feeder.ino) — บรรทัด 547-553

**ปัญหา**: เมื่อผู้ใช้กด "หยุดฉุกเฉิน" → `handleLocalStop()` → `stopFeeding()` → มี `delay(1000)` อยู่ → Web Response จะล่าช้า 1 วินาที เป็นปัญหาสำหรับ "ฉุกเฉิน" ที่ต้องการความรวดเร็ว

---

### [BUG-11] `getHistory()` บน Vercel ไม่ได้ใช้ตัวแปร `limit` จาก query แบบปลอดภัย

**ระดับ**: 🟡 LOW  
**ไฟล์**: [`history.js`](file:///d:/project/feeder_project/esp32/fish_feeder/data/api/history.js) — บรรทัด 10-16

**ปัญหา**:
```js
const limit = req.query.limit || 100;  // ← เป็น string จาก query
const { rows } = await sql`... LIMIT ${limit}`;  // ← ส่ง string เข้า SQL
```

`req.query.limit` จะได้ค่าเป็น string เสมอ ไม่ใช่ number → ขึ้นอยู่กับ library ว่าจะ parse ให้อัตโนมัติหรือเปล่า ควร `parseInt()` ก่อน

---

### [BUG-12] `feedAmount` ใน Calibration Form — ตรวจสอบผิด

**ระดับ**: 🟡 LOW  
**ไฟล์**: [`app.js`](file:///d:/project/feeder_project/esp32/fish_feeder/data/app.js) — บรรทัด 1028

**ปัญหา**:
```js
const val = document.getElementById("feedAmountInput")?.value;
if (val && val > 0) {   // ← val เป็น string, การเปรียบ "50" > 0 เป็น true แต่ "" > 0 เป็น false
```

ควรแปลงเป็นตัวเลขก่อน: `const val = Number(...)` หรือ `parseFloat(...)` แล้วค่อยตรวจ

---

### [BUG-13] `schedules.splice(index, 1)` — `index` เป็น String ไม่ใช่ Number

**ระดับ**: 🟡 LOW  
**ไฟล์**: [`app.js`](file:///d:/project/feeder_project/esp32/fish_feeder/data/app.js) — บรรทัด 754

**ปัญหา**:
```js
const index = e.currentTarget.dataset.index;  // ← เป็น string เช่น "2"
schedules.splice(index, 1);  // ← splice("2", 1) ในบาง engine อาจทำงานถูก แต่ไม่ดี
```

ควรแปลง: `schedules.splice(Number(index), 1)`
