# 🔒 รายงานด้านความปลอดภัย (Security Bugs)

> ⚠️ **ยังไม่มีการแก้ไขโค้ด** — เป็นรายงานการตรวจสอบเท่านั้น

---

## 🚨 ระดับ CRITICAL (อันตรายมาก — ต้องแก้ทันที)

---

### [SEC-01] รหัสผ่าน MQTT และฐานข้อมูลถูกฝังตายในโค้ด (Hardcoded Credentials)

**ระดับความเสี่ยง**: 🔴 CRITICAL  
**ไฟล์ที่เกี่ยวข้อง**:
- [`secrets.h`](file:///d:/project/feeder_project/esp32/fish_feeder/secrets.h) — บรรทัด 9-12
- [`app.js`](file:///d:/project/feeder_project/esp32/fish_feeder/data/app.js) — บรรทัด 11-13
- [`cron.js`](file:///d:/project/feeder_project/esp32/fish_feeder/data/api/cron.js) — บรรทัด 1, 35-38
- [`history.js`](file:///d:/project/feeder_project/esp32/fish_feeder/data/api/history.js) — บรรทัด 1
- [`schedule.js`](file:///d:/project/feeder_project/esp32/fish_feeder/data/api/schedule.js) — บรรทัด 1

**ปัญหา**: ข้อมูลลับที่ฝังอยู่ในโค้ดโดยตรง:

```js
// app.js — เปิดเผยต่อผู้ใช้ทุกคนที่เปิดหน้าเว็บ (ดูได้จาก DevTools)
const MQTT_OPTIONS = {
    username: "teerapat",
    password: "Teerapat99",       // ← เปิดเผยให้สาธารณะ!
};
```

```h
// secrets.h — commit ขึ้น GitHub แล้ว!
#define MQTT_HOST "97a545ab69f44dde939442a2b857bc3b.s1.eu.hivemq.cloud"
#define MQTT_USER "teerapat"
#define MQTT_PASS "Teerapat99"    // ← ถูกเปิดเผยใน Git History
```

```js
// cron.js — Database URL ทั้งหมด hardcode อยู่
process.env.POSTGRES_URL = process.env.POSTGRES_URL 
    || "postgresql://neondb_owner:npg_5MlVr8ydotek@ep-fancy-fog..."; // ← รหัสผ่าน DB
```

**ผลเสีย**: 
- ใครก็ตามที่เปิดหน้าเว็บ → กด F12 → ดูโค้ด → เห็นรหัสผ่าน MQTT → สามารถสั่งให้เครื่องทำงานได้เลย
- รหัสผ่านฐานข้อมูล Neon ถูก hardcode ใน `cron.js`, `history.js`, `schedule.js` → อยู่ใน Git Repository
- รหัสผ่านใน `.env` ก็ตรงกันทั้งหมด แสดงว่า `.env` ที่มีข้อมูลจริงเคยถูกเผยแพร่หรืออัปโหลด

---

### [SEC-02] `device-code` ถูก Hardcode เป็น "1234" ในหน้าเว็บ

**ระดับความเสี่ยง**: 🔴 CRITICAL  
**ไฟล์ที่เกี่ยวข้อง**:
- [`app.js`](file:///d:/project/feeder_project/esp32/fish_feeder/data/app.js) — บรรทัด 345, 357, 802, 890

**ปัญหา**:
```js
// app.js
const scheduleRes = await fetch("/api/schedule", {
    headers: { "x-device-id": DEVICE_ID, "x-device-code": "1234" }  // ← hardcode
});
```

**ผลเสีย**: ระบบ auth ที่สร้างขึ้นใน `auth.js` ไม่มีประโยชน์เลย เพราะรหัส "1234" เขียนไว้ในหน้าเว็บที่สาธารณะเห็นได้อยู่แล้ว

---

### [SEC-03] `secrets.h` ไม่ได้ถูก ignore โดย .gitignore

**ระดับความเสี่ยง**: 🔴 CRITICAL  
**ไฟล์ที่เกี่ยวข้อง**:
- [`.gitignore`](file:///d:/project/feeder_project/.gitignore)
- [`secrets.h`](file:///d:/project/feeder_project/esp32/fish_feeder/secrets.h)

**ปัญหา**: ไฟล์ `.gitignore` บล็อกแค่ `.env` แต่ไม่ได้บล็อก `secrets.h` ซึ่งมีรหัสผ่าน MQTT ครบ ไฟล์นี้จึงถูก commit และ push ขึ้น GitHub ไปแล้ว

---

## ⚠️ ระดับ HIGH (เสี่ยงสูง)

---

### [SEC-04] ระบบ `setInsecure()` บน ESP32 — SSL ไม่ถูกตรวจสอบ

**ระดับความเสี่ยง**: 🟠 HIGH  
**ไฟล์**: [`fish_feeder.ino`](file:///d:/project/feeder_project/esp32/fish_feeder/fish_feeder.ino) — บรรทัด 312  
**ไฟล์**: [`cron.js`](file:///d:/project/feeder_project/esp32/fish_feeder/data/api/cron.js) — บรรทัด 40

**ปัญหา**:
```cpp
// fish_feeder.ino
espClient.setInsecure(); // ← ปิดการตรวจสอบ SSL Certificate ทั้งหมด
```
```js
// cron.js
rejectUnauthorized: false   // ← ไม่ตรวจ SSL
```

**ผลเสีย**: เสี่ยงต่อการโจมตีแบบ Man-in-the-Middle (MITM) — ผู้โจมตีสามารถสวมรอยเป็น MQTT Broker ปลอมได้

---

### [SEC-05] `cron.js` ไม่มีการตรวจสอบสิทธิ์ (No Auth)

**ระดับความเสี่ยง**: 🟠 HIGH  
**ไฟล์**: [`cron.js`](file:///d:/project/feeder_project/esp32/fish_feeder/data/api/cron.js)

**ปัญหา**: ไม่มีการตรวจสอบ `x-device-id` หรือ `x-device-code` เลย ใครก็ตามที่รู้ URL `/api/cron` สามารถ trigger การให้อาหารได้ตามใจชอบ

---

### [SEC-06] CORS เปิดกว้างเกินไปบน ESP32

**ระดับความเสี่ยง**: 🟠 HIGH  
**ไฟล์**: [`fish_feeder.ino`](file:///d:/project/feeder_project/esp32/fish_feeder/fish_feeder.ino) — ทุก Handler

**ปัญหา**: ทุก API Endpoint บน ESP32 ตั้งค่า CORS เป็น `*`:
```cpp
server.sendHeader("Access-Control-Allow-Origin", "*");
```

ทำให้เว็บอื่นสามารถเรียก API ของเครื่องได้ หากผู้ใช้อยู่ใน Network เดียวกัน (ถ้าเชื่อมต่อ AP Mode)

---

## 🟡 ระดับ MEDIUM

---

### [SEC-07] `history.js` รับ `x-device-id` จาก Header โดยตรง

**ระดับความเสี่ยง**: 🟡 MEDIUM  
**ไฟล์**: [`history.js`](file:///d:/project/feeder_project/esp32/fish_feeder/data/api/history.js) — บรรทัด 5-6

**ปัญหา**:
```js
const rawDeviceId = req.headers["x-device-id"] || process.env.DEVICE_ID || "Prototype_01";
const DEVICE_ID = decodeURIComponent(rawDeviceId);
```

ถ้า URL Decode ไม่ถูกต้อง อาจทำให้เกิด SQL Injection ในบาง Edge Case (ขึ้นอยู่กับว่า `@vercel/postgres` protect ได้ดีแค่ไหน)

---

### [SEC-08] `handleScanWifi()` บน ESP32 ไม่มีการ Escape ชื่อ WiFi

**ระดับความเสี่ยง**: 🟡 MEDIUM  
**ไฟล์**: [`fish_feeder.ino`](file:///d:/project/feeder_project/esp32/fish_feeder/fish_feeder.ino) — บรรทัด 749-759

**ปัญหา**: ชื่อ SSID ที่มีอักขระพิเศษ เช่น `"`, `\`, จะทำให้ JSON ที่ Build ด้วยการต่อ String พัง:
```cpp
json += "\"" + WiFi.SSID(i) + "\"";  // ← ไม่ escape
```

---

### [SEC-09] `temp_app.js` อยู่ใน Root โปรเจค

**ระดับความเสี่ยง**: 🟡 MEDIUM  
**ไฟล์**: `temp_app.js` (ขนาด ~49KB)

**ปัญหา**: ไฟล์ temp ขนาดใหญ่ที่มี Code และอาจมีข้อมูลสำคัญอยู่ใน Repository ควรลบออก
