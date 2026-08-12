# DS1302 RTC Implementation Tasks

- [x] Add `makuna/RTC` library to `platformio.ini`
- [x] Add `#include <ThreeWire.h>` and `#include <RtcDS1302.h>` to `fish_feeder.ino`
- [x] Setup `ThreeWire myWire(21, 22, 14);` and `RtcDS1302<ThreeWire> Rtc(myWire);` in `fish_feeder.ino`
- [x] Initialize RTC in `setup()`
- [x] Sync RTC with NTP time when WiFi connects
- [x] Update `checkSchedules()` to use time from RTC instead of NTP
- [x] Test/Verify logic
- [x] Verify database insertion logic in `database.js` (`saveHistory`).
- [x] Investigate why history events triggered in `auto` mode aren't saving to Neon database.
- [x] Increase `PubSubClient` buffer size in `fish_feeder.ino` to accommodate larger JSON arrays (`setBufferSize(2048)`).
- [x] Increase `DynamicJsonDocument` size for history payload to 2048.
- [x] Fix `handleHistory` in `mqtt.js` to correctly extract the latest history event from the array sent by ESP32 (`data[0]`).
