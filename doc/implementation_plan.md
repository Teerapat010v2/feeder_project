# DS1302 RTC Integration

เราจะทำการเพิ่มโมดูล DS1302 เข้าไปในระบบเพื่อให้ ESP32 สามารถจดจำเวลาได้แม่นยำแม้จะไม่มีอินเทอร์เน็ตหรือไฟดับ

## Proposed Changes

### 1. `platformio.ini`
เพิ่มไลบรารี `makuna/RTC` ลงใน `lib_deps` เพื่อให้ PlatformIO จัดการโหลดไลบรารีให้อัตโนมัติ

### 2. `fish_feeder.ino`
- นำเข้าไลบรารี `#include <ThreeWire.h>` และ `#include <RtcDS1302.h>`
- กำหนดขาพิน `ThreeWire myWire(21, 22, 14); // DAT, CLK, RST` และ `RtcDS1302<ThreeWire> Rtc(myWire);`
- ใน `setup()`:
  - สั่ง `Rtc.Begin()`
  - ตรวจสอบสถานะ RTC ว่าทำงานปกติหรือไม่
- อัปเดตฟังก์ชันเวลา:
  - หากต่อ WiFi ได้และซิงค์ NTP สำเร็จ ให้นำเวลาจาก NTP ไปบันทึกลง DS1302 (Sync)
  - ในฟังก์ชัน `checkSchedules()` ให้ดึงเวลาปัจจบุันจาก `Rtc.GetDateTime()` มาตรวจสอบเพื่อสั่งให้อาหารแทนการใช้เวลาจาก NTP โดยตรง

## Verification Plan
1. อัปโหลดโค้ดผ่าน PlatformIO ให้สำเร็จ
2. เปิด Serial Monitor เพื่อดูว่า ESP32 ตรวจพบ DS1302 หรือไม่
3. เมื่อเชื่อมต่อ WiFi สำเร็จ ควรเห็นข้อความว่าได้ซิงค์เวลากับ RTC แล้ว
4. ทดสอบปิดเราเตอร์ WiFi แล้วดูว่าระบบให้อาหารทำงานตามเวลาได้หรือไม่
