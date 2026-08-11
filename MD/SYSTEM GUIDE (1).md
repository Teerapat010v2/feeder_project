# Fish Feeder IoT — Project Skeleton (Generated)

โปรเจคนี้เป็นโครงงานตัวอย่างสำหรับระบบเครื่องให้อาหารปลาอัตโนมัติ (esp32 + HiveMQ + Firebase + Web Dashboard)
เอกสารอ้างอิงต้นฉบับอยู่ในไฟล์: ARCHITECTURE.md, PAGES.md, WORKFLOW.md, UI CONTROLS.md, SYSTEM GUIDE.md

โครงสร้างโฟลเดอร์ (ไฟล์สำคัญที่สร้างให้):

- esp32/
  - fish_feeder.ino       (Arduino sketch template)
  - README.md             (Wiring & upload notes)
- server/
  - index.js              (Simple Express server that emulates /auth Cloud Function and serves web)
  - devices.json          (Demo device credentials — DO NOT use plaintext in production)
- web/
  - index.html            (Device ID + Password page — demo)
  - app.js                (Client logic to call /auth)
  - dashboard.html        (Simple demo dashboard)
- package.json            (Node project manifest)
- .env.example            (Environment variables example)
- ARCHITECTURE.md, PAGES.md, WORKFLOW.md, UI CONTROLS.md, SYSTEM GUIDE.md (existing docs retained)

---

Quick start (local demo):

1) Node.js environment

- จากโฟลเดอร์โปรเจคนี้ รัน:

  npm install

  (ไฟล์ package.json มี dependencies ที่จำเป็น: express, body-parser, jsonwebtoken, cors)

2) ตัวอย่างตั้งค่า environment

- สำเนาไฟล์ .env.example เป็น .env และแก้ JWT_SECRET ตามต้องการ:

  copy .env.example .env   (บน Windows PowerShell / CMD)

3) เรียกใช้งาน server (จะเสิร์ฟหน้าเว็บและ /auth endpoint):

  npm start

- เปิดเบราว์เซอร์ที่: http://localhost:3000
- หมายเหตุ: ใน Local Mode (เชื่อมต่อกับ esp32 โดยตรงที่ 192.168.4.1) ไม่จำเป็นต้องกรอก Device ID/Password — หน้า Local Dashboard จะให้การเข้าถึงแบบไม่ต้องใส่รหัส (Local Mode เป็นการเข้าถึงอุปกรณ์โดยตรง)

- หน้าจอ demo จะให้กรอก Device ID และ Password — ตัวอย่าง devices.json มี deviceId `device123` และ password `password123` (เฉพาะ demo เท่านั้น)
- เมื่อเข้าสำเร็จ หน้าเว็บจะได้รับ token (JWT) ที่ฝัง deviceId ไว้ (หมดอายุ 1 ชั่วโมง)

4) esp32

- ไปที่โฟลเดอร์ esp32 และอ่าน fish_feeder.ino
- ติดตั้งไลบรารีที่จำเป็นใน Arduino IDE: PubSubClient, ArduinoJson, HX711, RTClib
- แก้ค่า WIFI_SSID / WIFI_PASS / MQTT_HOST / MQTT_USER / MQTT_PASS / deviceId ใน fish_feeder.ino ตามอุปกรณ์จริง
- อัปโหลดลงบอร์ด

5) ข้อมูลเพิ่มเติมและการนำไปใช้งานจริง

- เอกสารสถาปัตยกรรมและ workflow: ARCHITECTURE.md, WORKFLOW.md
- หน้าตาและฟังก์ชันของเว็บ: PAGES.md, UI CONTROLS.md
- คู่มือการทำงานของระบบ: SYSTEM GUIDE.md

ข้อควรระวัง (สำคัญ):
- ไม่ควรเก็บรหัสผ่านเป็น plaintext ในไฟล์ production — ใช้การ hash (bcrypt) และเก็บอย่างปลอดภัย เช่นใน Firebase
- หากเชื่อมต่อ HiveMQ ให้ใช้การเชื่อมต่อแบบ TLS พร้อมการตรวจสอบใบรับรอง อย่าใช้ setInsecure() ในผลิตจริง
- ไฟล์ firebase-service-account.json และคีย์/ข้อมูลลับอื่น ๆ ต้องเก็บไว้นอก repository (เช่นใน environment variables หรือ secret manager)

---

ต้องการให้จัดเตรียมส่วนใดเพิ่มเติมหรือให้เชื่อมต่อกับ Firebase/HiveMQ จริง (เช่น ตัวอย่างการตั้งค่า Cloud Function, ตัวอย่างการเชื่อมต่อ MQTT over WebSocket ในหน้าเว็บ, หรือโค้ด Arduino ฉบับสมบูรณ์) บอกมาได้เลย จะจัดให้ตามเอกสารต้นทาง

