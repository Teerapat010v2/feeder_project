# Fish Feeder IoT v2

## Wiring Diagram

---

# 1. esp32 NodeMCU Pinout

| GPIO | NodeMCU | Device |
|------|----------|---------|
| GPIO5 | D1 | Relay IN1 |
| GPIO4 | D2 | RTC SDA |
| GPIO0 | D3 | RTC SCL |
| GPIO2 | D4 | Status LED |
| GPIO14 | D5 | HX711 DT |
| GPIO12 | D6 | HX711 SCK |

---

# 2. HX711

| HX711 | esp32 |
|--------|----------|
| VCC | 3.3V |
| GND | GND |
| DT | D5 |
| SCK | D6 |

---

# 3. Load Cell

| Load Cell | HX711 |
|------------|--------|
| Red | E+ |
| Black | E- |
| White | A+ |
| Green | A- |

---

# 4. Relay Module

| Relay | esp32 |
|--------|----------|
| IN1 | D1 |
| VCC | VIN (5V) |
| GND | GND |

Relay COM
↓

12V Power Supply (+)

Relay NO
↓

Motor (+)

Motor (-)
↓

Power Supply (-)

---

# 5. DS3231 RTC

| DS3231 | esp32 |
|---------|----------|
| SDA | D2 |
| SCL | D3 |
| VCC | 3.3V |
| GND | GND |

---

# 6. LED Status

| LED | esp32 |
|------|----------|
| + | D4 ผ่านตัวต้านทาน 220Ω |
| - | GND |

LED แสดงสถานะ

- กระพริบ = กำลังเชื่อม WiFi
- ติด = Online
- ดับ = Offline

---

# 7. Power

esp32

USB 5V

HX711

3.3V จาก esp32

DS3231

3.3V จาก esp32

Relay

VIN (5V)

Motor

12V DC

---

# MQTT Topics

Publish

fishfeeder/status

fishfeeder/weight

fishfeeder/history

fishfeeder/alert

Subscribe

fishfeeder/command

fishfeeder/schedule

---

# JSON Command

Feed

```json
{
    "action":"feed",
    "grams":30
}
```

Stop

```json
{
    "action":"stop"
}
```

Schedule

```json
{
    "schedules":[
        {
            "time":"08:00",
            "enable":true
        },
        {
            "time":"18:00",
            "enable":true
        }
    ]
}
```

---

# Dashboard

Web Browser

↓

Node.js Server

↓

HiveMQ Cloud

↓

esp32

↓

Relay

↓

Motor

↓

Fish Feeder

---

# Firestore Collections

device

history

alerts

schedule

settings

---

# Project Structure

```
fish-feeder-iot/

server/

web/

esp32/

doc/

package.json

.env

firebase-service-account.json

render.yaml

README.md
```

---

Developed by Fish Feeder IoT v2
