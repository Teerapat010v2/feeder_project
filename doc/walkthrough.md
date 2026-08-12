# ภาพรวมระบบ Smart Fish Feeder (อัปเดตล่าสุด)

ระบบเครื่องให้อาหารปลาอัจฉริยะ (Smart Fish Feeder) ได้รับการพัฒนาและแก้ไขปัญหาต่างๆ จนสามารถทำงานได้อย่างสมบูรณ์แบบทั้งในแบบออฟไลน์และออนไลน์ โดยมีรายละเอียดความสามารถและซอฟต์แวร์ที่ใช้ดังนี้

## 🌟 ความสามารถของระบบในปัจจุบัน (Features)

### 1. ระบบให้อาหารและควบคุม (Feeding & Control)
- **โหมดให้อาหารด้วยตัวเอง (Manual):** สั่งให้อาหารทันทีผ่านหน้าเว็บ (ทั้ง Local และ Online) พร้อมกำหนดปริมาณเป็นกรัมได้แม่นยำ
- **โหมดอัตโนมัติ (Auto):** ตั้งเวลาให้อาหารล่วงหน้าได้สูงสุด 4 รอบต่อวัน พร้อมกำหนดปริมาณอาหารที่ต่างกันในแต่ละรอบได้
- **ระบบชั่งน้ำหนักอาหาร (Loadcell):** 
  - คำนวณปริมาณอาหารที่จ่ายออกไปจริงจากน้ำหนักที่หายไป (ชั่งก่อนและหลังเปิดมอเตอร์)
  - แสดงน้ำหนักอาหารคงเหลือในถังแบบ Real-time บนหน้าเว็บ

### 2. ระบบรักษาเวลาแม้ไม่มีอินเทอร์เน็ต (Offline Timekeeping)
- **โมดูล RTC DS1302:** เพิ่มความสามารถในการจดจำเวลาแม้ไฟดับหรือไม่มีอินเทอร์เน็ต
- **Auto-Sync:** เมื่อเชื่อมต่อ WiFi ได้ ESP32 จะดึงเวลามาตรฐาน (NTP) มาฝังลงใน RTC อัตโนมัติ
- **Offline Schedule:** ระบบตรวจสอบเวลาจาก RTC เป็นหลัก ทำให้สามารถให้อาหารตามตารางได้ตรงเวลาเป๊ะ แม้ปิดเราเตอร์ WiFi ทิ้งไว้

### 3. ระบบเชื่อมต่อ 2 โหมด (Local & Online)
- **Local Mode (AP Mode & Home WiFi):**
  - เครื่องกระจายสัญญาณ WiFi (AP) ชื่อ `FishFeeder-AP` สำหรับเข้าตั้งค่าได้โดยตรง
  - หน้าเว็บควบคุมแบบ Local (IP: `192.168.4.1` หรือ IP ของบ้าน) โหลดไวและไม่ใช้อินเทอร์เน็ต
  - ไอคอนแบบฝังในตัว (Inline SVGs) ทำให้หน้าเว็บสวยงามและสมบูรณ์ 100% แม้ไม่มีเน็ต
- **Online Mode (Vercel + MQTT):**
  - ควบคุมผ่านอินเทอร์เน็ตได้จากทุกที่ทั่วโลก
  - ประมวลผลและอัปเดตตารางเวลา (Schedule) ผ่านระบบ MQTT (HiveMQ) ที่ฝังความจำแบบ Retained ทำให้หน้าเว็บได้รับข้อมูลตารางเวลาที่ถูกต้องทันทีที่เปิดเว็บ โดยไม่ต้องง้อ Backend Server

### 4. ความปลอดภัยและความเสถียร
- ระบบป้องกันมอเตอร์ค้าง หากพบปัญหาตาชั่ง (HX711) อ่านค่าผิดพลาด
- ระบบบังคับสลับโหมดอัตโนมัติเมื่อกดสั่งงานเอง
- แก้ไขบั๊กหน้าเว็บค้าง ทำให้ UI โหลดได้ลื่นไหลเสมอ

---

## 🛠️ ซอฟต์แวร์และเทคโนโลยีที่ใช้ (Software & Tech Stack)

### ฝั่งฮาร์ดแวร์และเฟิร์มแวร์ (Hardware & Firmware)
- **Microcontroller:** ESP32 (รันบนเฟรมเวิร์ก Arduino)
- **IDE & Build Tool:** **VSCode + PlatformIO** (ใช้จัดการ Dependency และอัปโหลดโค้ด/SPIFFS ได้สะดวกและแม่นยำ)
- **Core Libraries (C++):**
  - `WiFi`, `WebServer`, `DNSServer`: สำหรับสร้าง Web Server ภายในและจัดการ Access Point
  - `SPIFFS`: ระบบไฟล์ในหน่วยความจำแฟลช (เก็บ HTML, CSS, JS)
  - `bblanchon/ArduinoJson` (v6.21.6): สำหรับแปลงข้อมูลไปกลับในรูปแบบ JSON
  - `bogde/HX711` (v0.7.5): สำหรับอ่านค่าจากโมดูลแปลงสัญญาณตาชั่ง
  - `knolleary/PubSubClient` (v2.8.0): สำหรับเชื่อมต่อกับเซิร์ฟเวอร์ MQTT
  - `makuna/RTC` (v2.5.0) & `ThreeWire`: สำหรับสื่อสารกับโมดูล DS1302

### การแก้ไขปัญหา MQTT Buffer และการประมวลผลข้อมูล
- Set `type="button"` on HTML buttons (`#addScheduleBtn`, `#saveSettingsBtn`) to prevent page reload on click in Local Mode.
- Increased `mqttClient.setBufferSize(2048)` in `fish_feeder.ino` to ensure large JSON arrays are not silently dropped by the MQTT library.
- Increased `DynamicJsonDocument histDoc(2048)` to ensure the array has enough memory to serialize up to 10 history records.
- Fixed `handleHistory` in `mqtt.js` (Render Backend) to parse the JSON array and correctly extract the newest event using `data[0]` (as the ESP32 pushes newest events to index 0).

## Remaining Known Issues to Monitor

> [!WARNING]
> **Render Sleep Issue:**
> Because the online Node.js backend is hosted on a free Render tier, it will go to sleep after 15 minutes of inactivity. When it is asleep, it disconnects from MQTT. If the ESP32 sends a history event during this time, Render will not receive it immediately. However, the ESP32 sends this message with `retained=true`, so HiveMQ will store it. The moment the Render backend is woken up (by an HTTP request to its URL), it will immediately receive the retained message and insert it into the Neon database.

> [!IMPORTANT]
> **Browser Caching on Vercel:**
> Vercel caches static assets heavily. If the UI does not update after changes to `app.js`, you must do a Hard Refresh (Ctrl+Shift+R) in the browser to clear the cache.

## Result

- Users can now save settings without the Local Mode web app crashing.
- History events (both Manual and Auto) are correctly recorded in the ESP32 RAM as an array.
- The history array is successfully published to the MQTT Broker without being truncated.

### ฝั่งหน้าเว็บ (Frontend)
- **เทคโนโลยีหลัก:** HTML5, CSS3, JavaScript (Vanilla JS ไม่ใช้ Framework เพิ่มความเบา)
- **UI & UX:** 
  - ดีไซน์สไตล์ Modern & Premium (คล้ายแอปพลิเคชัน)
  - แทนที่ FontAwesome ด้วย Inline SVG Emojis สำหรับโหมดออฟไลน์
- **Communication Protocol:**
  - Local Mode: `fetch()` API สำหรับเรียกใช้ Endpoints ของ ESP32 WebServer โดยตรง
  - Online Mode: `mqtt.js` รันผ่าน WebSockets ฝั่งเบราว์เซอร์ เพื่อรับส่งคำสั่งทางไกลไปยัง HiveMQ

### ฝั่งคลาวด์และเซิร์ฟเวอร์ (Cloud & Services)
- **MQTT Broker:** **HiveMQ** (Public Broker) ใช้เป็นคนกลางส่งข้อความ (Topics: `status`, `cmd/command`, `schedule`)
- **Hosting:** **Vercel** สำหรับโฮสต์หน้าเว็บออนไลน์ (สแตติกไฟล์) ให้โหลดผ่านเน็ตเวิร์คความเร็วสูงฟรี
