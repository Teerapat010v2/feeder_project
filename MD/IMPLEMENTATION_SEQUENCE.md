# Fish Feeder IoT

ระบบเครื่องให้อาหารปลาอัตโนมัติด้วย esp32 + MQTT + Firebase

---

# Hardware

- esp32 NodeMCU
- HX711
- Load Cell 5kg
- Relay Module 5V
- DC Motor 12V
- DS3231 RTC
- LED Status

---

# Wiring

| esp32 | Device |
|---------|--------|
| D1 (GPIO5) | Relay IN1 |
| D2 (GPIO4) | DS3231 SDA |
| D3 (GPIO0) | DS3231 SCL |
| D4 (GPIO2) | Status LED |
| D5 (GPIO14) | HX711 DT |
| D6 (GPIO12) | HX711 SCK |
| 3.3V | HX711 VCC, RTC VCC |
| VIN (5V) | Relay VCC |
| GND | GND ทุกอุปกรณ์ |

---

# HX711

| HX711 | Load Cell |
|-------|-----------|
| E+ | Red |
| E- | Black |
| A+ | White |
| A- | Green |

---

# Relay

Relay IN1 -> D1

Relay COM -> +12V

Relay NO -> Motor +

Motor - -> Power Supply -

---

# MQTT

// -------- MQTT --------
const char* mqtt_server = "97a545ab69f44dde939442a2b857bc3b.s1.eu.hivemq.cloud";
const int mqtt_port = 8883;
const char* mqtt_user = "teerapat";
const char* mqtt_pass = "Teerapat99";

// -------- Topic --------
const char* topic_control = "myhome/livingroom/light";
const char* topic_status  = "myhome/livingroom/status";

> **หมายเหตุ:** อย่าเก็บรหัสผ่าน MQTT ไว้ใน README หรือเผยแพร่บน GitHub

### Topics

Subscribe

```
myhome/livingroom/light
```

Publish

```
myhome/livingroom/status
```

---

# Firebase

Project ID

```
kaptun-e8c23
```

Service Account

```
firebase-service-account.json
```

Collections

```
device
history
alerts
schedule
settings
```

---

# Folder Structure

```
fish-feeder/

├── esp32/
├── server/
├── web/
├── firebase-service-account.json
├── package.json
├── .env
└── README.md
```

---

# Upload

1. ใส่ WiFi SSID และ Password
2. ใส่ MQTT Username และ Password
3. อัปโหลดโค้ดลง esp32
4. เปิด Dashboard
5. ทดสอบสั่งงานผ่าน MQTT

---

Developed by Fish Feeder IoT
