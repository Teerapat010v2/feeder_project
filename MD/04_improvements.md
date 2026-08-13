# 🏗️ สิ่งที่ควรปรับปรุง (Improvements)

> ⚠️ **ยังไม่มีการแก้ไขโค้ด** — เป็นรายงานการตรวจสอบเท่านั้น

---

## 🔥 สิ่งที่ควรทำก่อน (Priority สูง)

---

### [IMP-01] แก้ปัญหา Online Mode บันทึกประวัติก่อนอาหารออกจริง

**ไฟล์**: [`app.js`](file:///d:/project/feeder_project/esp32/fish_feeder/data/app.js) — บรรทัด 283-297

**แนวทาง**: ลบโค้ดที่บันทึก history จาก frontend ออกทั้งหมด แล้วให้ ESP32 เป็นคนบันทึกผ่าน MQTT topic `/history` เมื่อ `dispensed >= 1.0` (เหมือนที่ทำใน `stopFeeding()` แล้ว) — ปัจจุบัน Local Mode ถูกต้องแล้ว แต่ Online Mode ยังผิดอยู่

---

### [IMP-02] ย้าย MQTT Broker สำหรับ Cron ให้ตรงกับที่ ESP32 ใช้

**ไฟล์**: [`cron.js`](file:///d:/project/feeder_project/esp32/fish_feeder/data/api/cron.js) — บรรทัด 35-38

**แนวทาง**: ตรวจสอบว่าใช้ Broker ตัวเดียวกัน (`97a545ab69f44dde939442a2b857bc3b...`) และ credentials เดียวกัน (`teerapat` / `Teerapat99`) — ตอนนี้ Cron ใช้ Broker คนละตัว ทำให้ command ไม่ถึง ESP32

---

### [IMP-03] ตัดสินใจว่าจะใช้ Schedule จาก ESP32 หรือ Cron อย่างใดอย่างหนึ่ง

**แนวทาง** (เลือก 1 ใน 2):
- **Option A**: ใช้ ESP32 checkSchedules() เท่านั้น → ลบ `cron.js` ออก
- **Option B**: ใช้ Vercel Cron เท่านั้น → ปิด `checkSchedules()` ใน ESP32

การมีทั้ง 2 ทำให้อาหารอาจออกซ้ำ

---

## 🛡️ ด้านความปลอดภัยที่ควรทำ

---

### [IMP-04] เปลี่ยน MQTT Password และ Database Password ใหม่ทันที

เนื่องจากรหัสผ่านทั้งหมดถูก commit ขึ้น GitHub แล้ว:

1. **MQTT**: เข้า HiveMQ Cloud Console → เปลี่ยนรหัสผ่าน `teerapat`
2. **Database**: เข้า Neon Console → Rotate credentials
3. อัปเดต `secrets.h` และ `.env` ใหม่
4. เพิ่ม `secrets.h` ลงใน `.gitignore`

---

### [IMP-05] เพิ่ม `secrets.h` เข้า `.gitignore`

**ไฟล์**: [`.gitignore`](file:///d:/project/feeder_project/.gitignore)

เพิ่มบรรทัดนี้:
```
esp32/fish_feeder/secrets.h
```

---

### [IMP-06] ย้าย MQTT Credentials ออกจาก `app.js` (Frontend)

ปัจจุบัน MQTT credentials ถูก hardcode ใน `app.js` ที่ใครก็ดูได้ผ่าน Browser DevTools แนวทางที่ดีกว่า:
- สร้าง API endpoint ที่ออก Temporary Token หรือ Anonymous credentials สำหรับ subscribe เท่านั้น
- หรือ จำกัดสิทธิ์ใน HiveMQ ให้ user `teerapat` publish ไม่ได้ — ให้ publish ได้แค่จาก Server เท่านั้น

---

## ⚙️ ด้านโครงสร้างและ Code Quality

---

### [IMP-07] แยก `app.js` เป็นไฟล์แยกตามหน้า

ตอนนี้ `app.js` ขนาด 56KB รวมทุกอย่างไว้ในไฟล์เดียว เวลาโหลดหน้าใดหน้าหนึ่งจะโหลด code ของทุกหน้า

**แนวทาง**:
```
data/js/
  ├── core.js          ← ค่าคงที่, MQTT config, isLocalMode
  ├── dashboard.js     ← หน้า index
  ├── schedule.js      ← หน้า schedule
  ├── history.js       ← หน้า history
  └── settings.js      ← หน้า settings
```

---

### [IMP-08] สร้างโฟลเดอร์ `web/` หรือแก้ path ใน `server.js`

**ไฟล์**: [`server.js`](file:///d:/project/feeder_project/server/server.js) — บรรทัด 47

ตอนนี้ Backend Render จะ serve static file ไม่ได้เพราะโฟลเดอร์ไม่มีอยู่:
```js
app.use(express.static(path.join(__dirname, "../web")));  // ← ไม่มี /web
```

ถ้าต้องการให้ Backend มีหน้าเว็บด้วย ต้องสร้างโฟลเดอร์ `web/` หรือเปลี่ยน path

---

### [IMP-09] แก้ `connectMQTT()` ใน ESP32 ให้เป็น Non-Blocking

**ไฟล์**: [`fish_feeder.ino`](file:///d:/project/feeder_project/esp32/fish_feeder/fish_feeder.ino) — บรรทัด 166-190

**แนวทาง**: เปลี่ยนจาก `while` loop ที่ block ไปเป็น pattern ที่ตรวจใน `loop()` แทน:
```cpp
// ใน loop()
if (WiFi.status() == WL_CONNECTED && !mqttClient.connected()) {
    static unsigned long lastAttempt = 0;
    if (millis() - lastAttempt > 5000) {
        lastAttempt = millis();
        mqttClient.connect(...);  // ← ไม่ block
    }
}
```

---

### [IMP-10] ปรับ `updateDevice()` ให้ใช้ Parameterized Query แทน String Interpolation

**ไฟล์**: [`database.js`](file:///d:/project/feeder_project/server/database.js) — บรรทัด 19-35

**แนวทาง**: Refactor ให้ใช้ `@vercel/postgres` แบบ template literal ที่ safe สำหรับทุก column หรือ whitelist column ที่ update ได้และ cast type ให้ชัดเจน

---

### [IMP-11] เพิ่ม Transaction ใน `saveSchedules()`

**ไฟล์**: [`database.js`](file:///d:/project/feeder_project/server/database.js) — บรรทัด 189-203

```js
// แนวทาง: ใช้ Transaction
async function saveSchedules(schedules) {
    const pool = /* ... */;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM schedules WHERE device_id = $1', [DEVICE_ID]);
        for (const item of schedules) {
            await client.query('INSERT INTO schedules ...', [...]);
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}
```

---

### [IMP-12] แก้ `handleApiStatus()` ให้ใช้ `forceManualMode` แทนการดู Schedule

**ไฟล์**: [`fish_feeder.ino`](file:///d:/project/feeder_project/esp32/fish_feeder/fish_feeder.ino) — บรรทัด 591-612

เปลี่ยนจาก:
```cpp
String currentMode = "MANUAL";
for (int i = 0; i < scheduleCount; i++) { ... }
```
เป็น:
```cpp
String currentMode = forceManualMode ? "MANUAL" : "AUTO";
```

---

### [IMP-13] ลดความถี่ MQTT Publish จาก 1 วินาที เป็น 5-10 วินาที

**ไฟล์**: [`fish_feeder.ino`](file:///d:/project/feeder_project/esp32/fish_feeder/fish_feeder.ino) — บรรทัด 496

ลดโหลดบน HiveMQ Free Tier และ Database การ publish ทุก 5-10 วินาทีก็เพียงพอสำหรับการแสดงน้ำหนัก

---

### [IMP-14] ลบไฟล์ `temp_app.js` ออกจากโปรเจค

ไฟล์นี้ดูเหมือน backup เก่า ขนาด ~49KB มีอยู่ใน Root โดยไม่จำเป็น

---

### [IMP-15] อัปเดต Schema ใน `initDB.js` ให้มี `amount` column

**ไฟล์**: [`initDB.js`](file:///d:/project/feeder_project/server/initDB.js) — บรรทัด 48-56

เพิ่ม `amount NUMERIC DEFAULT 10` ในตาราง `schedules` ให้ตรงกับ `schema.sql`

---

## 📊 สรุปภาพรวม

| หมวด | จำนวนปัญหา | ระดับสูงสุด |
|------|-----------|------------|
| Security | 9 | 🔴 CRITICAL |
| Logic Bugs | 13 | 🔴 HIGH |
| Warnings | 10 | 🔴 HIGH |
| Improvements | 15 | หลากหลาย |
| **รวม** | **47** | |

### ลำดับความเร่งด่วน
1. 🔴 **ด่วนที่สุด**: เปลี่ยนรหัสผ่าน MQTT + Database ที่รั่วไปแล้ว
2. 🔴 **ด่วนมาก**: แก้ Cron ให้ใช้ Broker เดียวกับ ESP32 (ตอนนี้ Schedule ผ่าน Cron ไม่ทำงานเลย)
3. 🟠 **ด่วน**: แก้บันทึกประวัติ Online Mode ให้ถูกต้อง
4. 🟠 **ด่วน**: แก้ `connectMQTT()` ไม่ให้ block Loop
5. 🟡 **ทำเมื่อมีเวลา**: Refactor `app.js`, เพิ่ม Transaction, ปรับปรุงโครงสร้างโค้ด
