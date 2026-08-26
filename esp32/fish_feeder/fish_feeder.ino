#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <SPIFFS.h>
#include <Wire.h>
#include "HX711.h"
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>
#include "secrets.h"
#include <ThreeWire.h>
#include <RtcDS1302.h>

// =================================================================
// 📌 1. โซนตั้งค่าพินฮาร์ดแวร์ (HARDWARE PIN CONFIG)
// =================================================================
#define HX711_DT   16   
#define HX711_SCK  17   
#define MOTOR_ENA  18
#define MOTOR_IN1  5
#define MOTOR_IN2  13   

#define LED_R      19   
#define LED_G      23   
#define LED_B      25   

// =================================================================
// 📌 2. โซนปรับแต่งค่าการทำงาน (ADJUSTABLE PARAMETERS)
// =================================================================
#define CALIBRATION_FACTOR 220.4  


int currentMotorSpeed = 100;

// =================================================================
// 📌 3. ประกาศตัวแปรและออบเจ็กต์ของระบบ (SYSTEM OBJECTS)
// =================================================================
ThreeWire myWire(21, 22, 14); // DAT, CLK, RST
RtcDS1302<ThreeWire> Rtc(myWire);

HX711 scale;                    
WebServer server(80);           
DNSServer dnsServer;            
Preferences preferences;        
WiFiClientSecure espClient;
PubSubClient mqttClient(espClient);

bool isFeeding = false;         
unsigned long feedStartTime = 0;
unsigned long feedDuration = 0; 
unsigned long lastMqttPublish = 0;
String deviceId = "feeder_";
float weightBeforeFeed = 0.0;
bool forceManualMode = false;
String currentFeedMode = "manual";

// --- NTP & Scheduling ---
const char* ntpServer = "pool.ntp.org";
const long  gmtOffset_sec = 7 * 3600; // GMT+7
const int   daylightOffset_sec = 0;

struct ScheduleEntry {
  int hour;
  int minute;
  int amount;
  bool enable;
};
ScheduleEntry localSchedules[4];
int scheduleCount = 0;
int lastCheckedMinute = -1;

// --- History ---
#define MAX_HISTORY 10
struct HistoryEntry {
  String timestamp;
  int amount;
  String mode;
};
HistoryEntry feedHistory[MAX_HISTORY];
int historyCount = 0;

// --- ประกาศชื่อฟังก์ชันล่วงหน้า (Function Prototypes) ---
void triggerFeeding(int amountGrams, String mode = "manual");
void stopFeeding();
void handleApiStatus();
void handleLocalFeed();
void handleLocalStop();
void handleSetMode();
void handleSetTime();
void handleSaveWifi();
void handleSaveApWifi();
void handleResetWifi();
void handleScanWifi();
void handleGetHistory();
void handleSetSpeed();
void handleClearHistory();
void handleDummyEmptyArray();
void handleDummySuccess();
bool handleFileRead(String path);
void setRGB(bool r, bool g, bool b);
void testMotorSerial();
void updateLocalSchedulesFromJson(String json);

// =================================================================
// 📌 3.5. ฟังก์ชัน MQTT Callback & Connect
// =================================================================
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  Serial.print("📩 MQTT Topic: ");
  Serial.print(topic);
  Serial.print(" | Payload: ");
  Serial.println(message);

  String topicStr = String(topic);
  if (topicStr.endsWith("/schedule")) {
    updateLocalSchedulesFromJson(message);
    return;
  }

  StaticJsonDocument<256> doc;
  DeserializationError error = deserializeJson(doc, message);
  if (error) {
    Serial.println("❌ Parse JSON ไม่สำเร็จ");
    return;
  }

  const char* action = doc["action"];
  if (action) {
    if (strcmp(action, "FEED") == 0) {
      int amount = doc["amount"] | 10;
      String mode = doc["mode"] | "manual";
      triggerFeeding(amount, mode);
    } else if (strcmp(action, "EMERGENCY_STOP") == 0) {
      stopFeeding();
    } else if (strcmp(action, "SET_SPEED") == 0) {
      currentMotorSpeed = doc["speed"] | 100;
      if(currentMotorSpeed < 0) currentMotorSpeed = 0;
      if(currentMotorSpeed > 100) currentMotorSpeed = 100;
      preferences.begin("motor_config", false);
      preferences.putInt("speed", currentMotorSpeed);
      preferences.end();
      publishMQTTStatus();
    } else if (strcmp(action, "SET_MODE") == 0) {
      forceManualMode = (strcmp(doc["mode"] | "AUTO", "MANUAL") == 0);
      saveModeSettings();
      publishMQTTStatus();
    } else if (strcmp(action, "TARE") == 0) {
      scale.tare();
      publishMQTTStatus();
    } else if (strcmp(action, "CALIBRATE") == 0) {
      float known_weight = doc["weight"] | 0.0;
      if (known_weight > 0) {
        float factor = scale.get_value(10) / known_weight;
        scale.set_scale(factor);
        preferences.putFloat("calib_factor", factor);
        publishMQTTStatus();
      }
    } else if (strcmp(action, "SET_AP_WIFI") == 0) {
      const char* apSsid = doc["apSsid"];
      const char* apPass = doc["apPass"];
      if (apSsid) {
        preferences.begin("wifi_config", false);
        preferences.putString("ap_ssid", apSsid);
        if (apPass && strlen(apPass) >= 8) preferences.putString("ap_pass", apPass);
        preferences.end();
        delay(1000);
        ESP.restart();
      }
    } else if (strcmp(action, "SET_HOME_WIFI") == 0) {
      const char* ssid = doc["ssid"];
      const char* pass = doc["pass"];
      if (ssid) {
        preferences.begin("wifi_config", false);
        preferences.putString("ssid", ssid);
        if (pass) preferences.putString("pass", pass);
        preferences.end();
        delay(1000);
        ESP.restart();
      }
    } else if (strcmp(action, "RESET_WIFI") == 0) {
      preferences.begin("wifi_config", false);
      preferences.clear();
      preferences.end();
      delay(1000);
      ESP.restart();
    } else if (strcmp(action, "CLEAR_HISTORY") == 0) {
      historyCount = 0;
      saveHistoryToSPIFFS();
      if (WiFi.status() == WL_CONNECTED && mqttClient.connected()) {
          String historyTopic = "fishfeeder/" + deviceId + "/history";
          mqttClient.publish(historyTopic.c_str(), "[]", true);
      }
    }
  }
}

void connectMQTT() {
  if (WiFi.status() != WL_CONNECTED) return;
  
  while (!mqttClient.connected()) {
    Serial.print("📡 กำลังเชื่อมต่อ MQTT (HiveMQ)... ");
    String statusTopic = "fishfeeder/" + deviceId + "/status";
    String lwtMessage = "{\"online\":false, \"status\":\"OFFLINE\", \"deviceId\":\"" + deviceId + "\"}";
    
    if (mqttClient.connect(deviceId.c_str(), MQTT_USER, MQTT_PASS, statusTopic.c_str(), 1, true, lwtMessage.c_str())) {
      Serial.println("✅ เชื่อมต่อ MQTT สำเร็จ (พร้อม LWT)");
      String cmdTopic = "fishfeeder/" + deviceId + "/cmd/command";
      String scheduleTopic = "fishfeeder/" + deviceId + "/schedule";
      mqttClient.subscribe(cmdTopic.c_str());
      mqttClient.subscribe(scheduleTopic.c_str());
      
      // ส่งสถานะ Online ทันทีเมื่อเชื่อมต่อสำเร็จ
      publishMQTTStatus();
      
      // ส่งตารางเวลาล่าสุดให้หน้าเว็บออนไลน์
      if (SPIFFS.exists("/schedules.json")) {
        File file = SPIFFS.open("/schedules.json", FILE_READ);
        if (file) {
          String json = file.readString();
          file.close();
          mqttClient.publish(scheduleTopic.c_str(), json.c_str(), true); // retain=true
        }
      }

      // ส่งประวัติล่าสุด
      DynamicJsonDocument histDoc(1024);
      JsonArray array = histDoc.to<JsonArray>();
      for (int i = historyCount - 1; i >= 0; i--) {
        JsonObject obj = array.createNestedObject();
        obj["timestamp"] = feedHistory[i].timestamp;
        obj["amount"] = feedHistory[i].amount;
        obj["mode"] = feedHistory[i].mode;
      }
      String histPayload;
      serializeJson(histDoc, histPayload);
      String historyTopic = "fishfeeder/" + deviceId + "/history";
      mqttClient.publish(historyTopic.c_str(), histPayload.c_str(), true);

    } else {
      Serial.print("❌ ล้มเหลว State=");
      Serial.print(mqttClient.state());
      Serial.println(" รอ 5 วินาทีเพื่อลองใหม่");
      delay(5000);
    }
  }
}

// =================================================================
// 📌 4. ฟังก์ชันเปิด/ปิดไฟ RGB LED สถานะ
// =================================================================
void setRGB(bool r, bool g, bool b) {
  digitalWrite(LED_R, r ? HIGH : LOW);
  digitalWrite(LED_G, g ? HIGH : LOW);
  digitalWrite(LED_B, b ? HIGH : LOW);
}

void updateStatusLED() {
  if (mqttClient.connected()) {
    // โหมดออนไลน์ = สีเขียว
    setRGB(false, true, false);
  } else if (WiFi.status() == WL_CONNECTED || WiFi.getMode() == WIFI_AP || WiFi.getMode() == WIFI_AP_STA) {
    // โหมด Local (WiFi/AP) = สีเหลือง (แดง+เขียว)
    setRGB(true, true, false);
  } else {
    // มีไฟเข้าแต่ยังไม่เชื่อมต่ออะไรเลย = สีแดง
    setRGB(true, false, false);
  }
}

// =================================================================
// 📌 4.5 ฟังก์ชันโหลด/บันทึกโหมด
// =================================================================
void saveModeSettings() {
  File file = SPIFFS.open("/mode.json", "w");
  if (file) {
    StaticJsonDocument<128> doc;
    doc["manual"] = forceManualMode;
    serializeJson(doc, file);
    file.close();
  }
}

void loadModeSettings() {
  if (SPIFFS.exists("/mode.json")) {
    File file = SPIFFS.open("/mode.json", "r");
    if (file) {
      StaticJsonDocument<128> doc;
      if (!deserializeJson(doc, file)) {
        forceManualMode = doc["manual"] | false;
      }
      file.close();
    }
  }
}

// =================================================================
// 📌 5. ฟังก์ชันเช็กนามสกุลไฟล์เว็บ
// =================================================================
String getContentType(String filename) {
  if (filename.endsWith(".html")) return "text/html";
  else if (filename.endsWith(".css")) return "text/css";
  else if (filename.endsWith(".js")) return "application/javascript";
  else if (filename.endsWith(".png")) return "image/png";
  else if (filename.endsWith(".jpg")) return "image/jpeg";
  else if (filename.endsWith(".ico")) return "image/x-icon";
  else if (filename.endsWith(".json")) return "application/json";
  return "text/plain";
}

// =================================================================
// 📌 6. ฟังก์ชันอ่านไฟล์จาก SPIFFS
// =================================================================
bool handleFileRead(String path) {
  if (path.endsWith("/")) path += "index.html"; 
  
  String contentType = getContentType(path);
  if (SPIFFS.exists(path)) {
    File file = SPIFFS.open(path, "r");
    // เพิ่ม Cache-Control เพื่อให้เบราว์เซอร์จำไฟล์ CSS/JS ไว้ ไม่ต้องโหลดใหม่ทุกครั้ง (ทำให้หน้าเว็บโหลดเร็วขึ้นมาก)
    server.sendHeader("Cache-Control", "max-age=86400");
    server.streamFile(file, contentType);
    file.close();
    return true;
  }
  return false;
}

// =================================================================
// 📌 7. ฟังก์ชันเริ่มต้นระบบ SETUP
// =================================================================
void setup() {
  Serial.begin(115200);
  delay(500);

  // กำหนดชื่อบอร์ดเป็น Prototype_01
  deviceId = "Prototype_01";
  
  Serial.println("\n--- [ESP32 Smart Fish Feeder Starting] ---");
  Serial.print("Device ID: ");
  Serial.println(deviceId);

  Rtc.Begin();
  if (!Rtc.GetIsRunning()) {
      Serial.println("⚠️ RTC ไม่ได้ทำงาน หรือถ่านหมด กำลังเริ่มต้นใหม่...");
      Rtc.SetIsRunning(true);
  }
  if (Rtc.GetIsWriteProtected()) {
      Serial.println("⚠️ RTC ติด Write Protect, ทำการปลดล็อก...");
      Rtc.SetIsWriteProtected(false);
  }

  pinMode(MOTOR_ENA, OUTPUT); pinMode(MOTOR_IN1, OUTPUT); pinMode(MOTOR_IN2, OUTPUT); ledcSetup(0, 1000, 8); ledcAttachPin(MOTOR_ENA, 0);
  pinMode(LED_R, OUTPUT);
  pinMode(LED_G, OUTPUT);
  pinMode(LED_B, OUTPUT);

  digitalWrite(MOTOR_IN1, LOW); digitalWrite(MOTOR_IN2, LOW); ledcWrite(0, 0);
  setRGB(false, false, true); 

  if (!SPIFFS.begin(true)) {
    Serial.println("❌ SPIFFS Mount Failed! กรุณาอัปโหลดโฟลเดอร์ data");
    return;
  }
  Serial.println("✅ SPIFFS Mounted Successfully");
  loadSchedules();
  loadHistoryFromSPIFFS(); // โหลดประวัติเก่า
  loadModeSettings(); // Load persisted mode

  preferences.begin("scale_config", true);
  float calib = preferences.getFloat("calib_factor", 220.4);
  preferences.end();
  
  preferences.begin("motor_config", true);
  currentMotorSpeed = preferences.getInt("speed", 100);
  preferences.end();
  
  scale.begin(HX711_DT, HX711_SCK);
  scale.set_scale(calib);
  scale.tare(); 
  Serial.println("✅ HX711 Loadcell Ready");

  WiFi.mode(WIFI_AP_STA);
  
  espClient.setInsecure(); // ไม่ตรวจสอบ SSL Cert
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(2048); // เพิ่ม Buffer Size รองรับ JSON Array ยาวๆ
  
  preferences.begin("wifi_config", true);
  String savedApSsid = preferences.getString("ap_ssid", "FishFeeder-AP");
  String savedApPass = preferences.getString("ap_pass", "");
  preferences.end();

  if (savedApPass.length() >= 8) {
    WiFi.softAP(savedApSsid.c_str(), savedApPass.c_str());
  } else {
    WiFi.softAP(savedApSsid.c_str());
  }
  
  Serial.print("🌐 Wi-Fi Access Point Ready: ");
  Serial.println(savedApSsid);

  dnsServer.start(53, "*", WiFi.softAPIP());

  // ===============================================================
  // 📌 เชื่อมต่อ Home Wi-Fi (ถ้ามีบันทึกไว้)
  // ===============================================================
  preferences.begin("wifi_config", true);
  String savedSsid = preferences.getString("ssid", "");
  String savedPass = preferences.getString("pass", "");
  preferences.end();

  if (savedSsid.length() > 0) {
    Serial.print("📡 กำลังเชื่อมต่อ Home Wi-Fi: ");
    Serial.println(savedSsid);
    WiFi.begin(savedSsid.c_str(), savedPass.c_str());
    
    int retries = 0;
    while (WiFi.status() != WL_CONNECTED && retries < 20) { // รอ 10 วินาที
      delay(500);
      Serial.print(".");
      retries++;
    }
    Serial.println();
    
    if (WiFi.status() == WL_CONNECTED) {
      Serial.print("✅ เชื่อมต่อ Home Wi-Fi สำเร็จ! IP Address (สำหรับเข้าเว็บวงแลนเดียวกัน): ");
      Serial.println(WiFi.localIP());

      // 🕒 ซิงค์เวลาจาก NTP
      configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
      Serial.println("🕒 กำลังซิงค์เวลาจาก NTP...");
      
      struct tm timeinfo;
      if (getLocalTime(&timeinfo, 10000)) { // รอสูงสุด 10 วินาที
        Serial.println("✅ รับเวลาจาก NTP สำเร็จ");
        // อัปเดตเวลาลง DS1302
        RtcDateTime compiled = RtcDateTime(
          timeinfo.tm_year + 1900,
          timeinfo.tm_mon + 1,
          timeinfo.tm_mday,
          timeinfo.tm_hour,
          timeinfo.tm_min,
          timeinfo.tm_sec
        );
        Rtc.SetDateTime(compiled);
        Serial.println("✅ บันทึกเวลาลงชิป RTC (DS1302) สำเร็จ!");
      } else {
        Serial.println("⚠️ ดึงเวลาจาก NTP ไม่สำเร็จ");
      }
    } else {
      Serial.println("❌ เชื่อมต่อ Home Wi-Fi ไม่สำเร็จ (ระบบจะใช้ AP Mode ต่อไป)");
    }
  } else {
    Serial.println("ℹ️ ยังไม่มีการตั้งค่า Home Wi-Fi (ระบบอยู่ในโหมด AP เท่านั้น)");
  }

  // ===============================================================
  // 📌 8. กำหนดเส้นทาง API Endpoints ทั้งหมด
  // ===============================================================
  server.on("/api/status", handleApiStatus);     
  server.on("/local-feed", handleLocalFeed);
  server.on("/local-feed", HTTP_GET, handleLocalFeed);
  server.on("/local-stop", HTTP_GET, handleLocalStop);
  server.on("/local-tare", HTTP_GET, handleLocalTare);
  server.on("/local-calib", HTTP_GET, handleLocalCalibrate);
  server.on("/api/stop", handleLocalStop);
  server.on("/api/set-mode", HTTP_GET, handleSetMode);
  server.on("/api/set-speed", HTTP_GET, handleSetSpeed);
  server.on("/api/set-time", HTTP_POST, handleSetTime);
  
  // เส้นทางหน้า Settings และ Wi-Fi
  server.on("/api/save-wifi", handleSaveWifi);   
  server.on("/api/save-ap", handleSaveApWifi);
  server.on("/api/reset-wifi", handleResetWifi); 
  server.on("/api/scan-wifi", handleScanWifi);   

  // Endpoint ป้องกันหน้าเว็บค้าง
  server.on("/api/verify", HTTP_POST, handleDummySuccess);
  server.on("/api/history", HTTP_GET, handleGetHistory);
  server.on("/api/history", HTTP_DELETE, handleClearHistory);
  server.on("/api/alerts", HTTP_GET, handleDummyEmptyArray);
  server.on("/api/schedule", HTTP_GET, handleGetSchedule);
  server.on("/api/schedule", HTTP_POST, handlePostSchedule);
  server.on("/api/usage", HTTP_POST, handleDummySuccess);

  // ดักจับ /generate_204 กันมือถือสแปม
  server.on("/generate_204", []() {
    server.send(204, "text/plain", "");
  });

  // ดักจับไฟล์ที่ไม่พบอื่นๆ
  server.onNotFound([]() {
    String uri = server.uri();
    if (!handleFileRead(uri)) {
      if (uri != "/favicon.ico") {
        Serial.print("❌ [404 Not Found]: ");
        Serial.println(uri);
      }
      server.sendHeader("Location", "http://192.168.4.1/", true);
      server.send(302, "text/plain", "");
    }
  });

  server.begin();
  Serial.println("🚀 Web Server Ready at http://192.168.4.1");
}

// =================================================================
// 📌 8.5 ฟังก์ชันส่งสถานะขึ้น MQTT ทันที
// =================================================================
void publishMQTTStatus() {
    bool scaleReady = scale.wait_ready_timeout(100);
    float weight = scaleReady ? scale.get_units(3) : 0.0;
    if (weight < 0) weight = 0.0;
    
    // Check mode
    String currentMode = forceManualMode ? "MANUAL" : "AUTO";
    
    StaticJsonDocument<256> doc;
    doc["online"] = true;
    doc["motor_speed"] = currentMotorSpeed;
    doc["weight"] = weight;
    doc["current_weight"] = weight;
    doc["status"] = isFeeding ? "FEEDING" : "IDLE";
    doc["motor_status"] = isFeeding ? "FEEDING" : "READY";
    doc["scale_status"] = scaleReady ? "NORMAL" : "ERROR";
    doc["mode"] = currentMode;
  doc["motor_speed"] = currentMotorSpeed;
  doc["motor_speed"] = currentMotorSpeed;
    doc["deviceId"] = deviceId;
    
    String payload;
    serializeJson(doc, payload);
    
    String statusTopic = "fishfeeder/" + deviceId + "/status";
    // ใส่ true ตัวสุดท้ายเพื่อให้ Broker จำค่าล่าสุดไว้ (Retained Message)
    // ทำให้เวลาเปิดหน้าเว็บใหม่ จะเห็นค่าทันทีไม่ต้องรอรอบส่ง!
    mqttClient.publish(statusTopic.c_str(), payload.c_str(), true); 
}

void checkSchedules() {
  if (!Rtc.GetIsRunning()) {
    static unsigned long lastRtcErr = 0;
    if (millis() - lastRtcErr > 10000) {
      Serial.println("⏳ [RTC] รอเวลาจาก DS1302... (เครื่องอาจเพิ่งเปิดและไม่มีเน็ต)");
      lastRtcErr = millis();
    }
    return; // Time not set yet
  }

  RtcDateTime now = Rtc.GetDateTime();
  int currentHour = now.Hour();
  int currentMin = now.Minute();

  if (currentMin != lastCheckedMinute) {
    lastCheckedMinute = currentMin;
    Serial.printf("🕒 [RTC] เวลาปัจจุบัน: %02d:%02d | ตารางเวลาที่บันทึกไว้: %d รอบ\n", currentHour, currentMin, scheduleCount);
    
    if (forceManualMode) {
      Serial.println("🔒 โหมดถูกบังคับเป็น Manual, ข้ามการให้อาหารตามตาราง");
      return;
    }
    
    for (int i = 0; i < scheduleCount; i++) {
      if (localSchedules[i].enable && localSchedules[i].hour == currentHour && localSchedules[i].minute == currentMin) {
        Serial.printf("⏰ ได้เวลาให้อาหาร (Schedule): %02d:%02d | ปริมาณ %d กรัม\n", currentHour, currentMin, localSchedules[i].amount);
        triggerFeeding(localSchedules[i].amount, "auto");
        break; // Trigger only one schedule per minute
      }
    }
  }
}

// =================================================================
// 📌 9. ฟังก์ชันการทำงานหลัก LOOP
// =================================================================
void loop() {
  testMotorSerial();              

  dnsServer.processNextRequest(); 
  server.handleClient();          

  checkSchedules();          

  if (WiFi.status() == WL_CONNECTED) {
    if (!mqttClient.connected()) {
      connectMQTT();
    }
    mqttClient.loop();

    // ลดระยะเวลาจาก 5 วินาที เหลือ 1 วินาที เพื่อให้เว็บดึงน้ำหนักได้แบบ Real-time มากขึ้น
    if (millis() - lastMqttPublish >= 1000) {
      lastMqttPublish = millis();
      publishMQTTStatus();
    }
  }

  if (isFeeding) {
    setRGB(false, true, false); // Green while feeding
    if (millis() - feedStartTime >= feedDuration) {
      stopFeeding();              
      updateStatusLED(); // Restore status LED
    }
  } else {
    updateStatusLED();
  }

  // พิมพ์น้ำหนักลง Serial Monitor ทุกๆ 2 วินาที
  static unsigned long lastWeightPrint = 0;
  if (millis() - lastWeightPrint >= 2000) {
    lastWeightPrint = millis();
    if (scale.wait_ready_timeout(100)) {
      float currentWeight = scale.get_units(5);
      if (currentWeight < 0) currentWeight = 0.0;
      Serial.printf("⚖️ น้ำหนักปัจจุบัน: %.1f กรัม\n", currentWeight);
    } else {
      Serial.println("⚖️ ตาชั่ง: ไม่ตอบสนอง (ERROR)");
    }
  }

  yield(); 
}

// =================================================================
// 📌 10. ฟังก์ชันสั่งเปิดรีเลย์มอเตอร์
// =================================================================
void triggerFeeding(int amountGrams, String mode) {
  if (isFeeding) return; 

  unsigned long duration = (unsigned long)((amountGrams / 10.0) * 2000.0);
  if (duration < 1000) duration = 1000;
  
  feedDuration = duration;
  feedStartTime = millis();
  isFeeding = true;
  currentFeedMode = mode;
  weightBeforeFeed = scale.is_ready() ? scale.get_units(5) : 0.0;
  if (weightBeforeFeed < 0) weightBeforeFeed = 0.0;

    digitalWrite(MOTOR_IN1, HIGH); digitalWrite(MOTOR_IN2, LOW); 
  int pwmValue = map(currentMotorSpeed, 0, 100, 0, 255);
  ledcWrite(0, pwmValue);
  Serial.print("▶️ มอเตอร์เริ่มหมุนด้วยความเร็ว: ");
  Serial.print(currentMotorSpeed);
  Serial.print("% (PWM: ");
  Serial.print(pwmValue);
  Serial.println(")");

  
  Serial.print("🐟 กำลังให้อาหาร: ");
  Serial.print(amountGrams);
  Serial.print(" กรัม (เปิดมอเตอร์ ");
  Serial.print(duration);
  Serial.println(" ms)");
  
  if (WiFi.status() == WL_CONNECTED && mqttClient.connected()) {
    publishMQTTStatus();
  }
}

// =================================================================
// 📌 11. ฟังก์ชันสั่งปิดรีเลย์
// =================================================================

void sendHistoryToVercel(int amountGrams, String mode) {
  if(WiFi.status() == WL_CONNECTED) {
    WiFiClientSecure *client = new WiFiClientSecure;
    if(client) {
      client->setInsecure();
      HTTPClient https;
      String url = "https://feeder-project.vercel.app/api/history";
      if (https.begin(*client, url)) {
        https.addHeader("Content-Type", "application/json");
        https.addHeader("x-device-id", deviceId);
        
        StaticJsonDocument<200> doc;
        doc["amount"] = amountGrams;
        doc["mode"] = mode;
        String payload;
        serializeJson(doc, payload);
        
        int httpCode = https.POST(payload);
        if(httpCode > 0) {
          Serial.printf("✅ ส่งประวัติขึ้น Vercel สำเร็จ: %d\n", httpCode);
        } else {
          Serial.printf("❌ ส่งประวัติขึ้น Vercel ล้มเหลว: %s\n", https.errorToString(httpCode).c_str());
        }
        https.end();
      }
      delete client;
    }
  }
}

void stopFeeding() {
  isFeeding = false;
  digitalWrite(MOTOR_IN1, LOW); digitalWrite(MOTOR_IN2, LOW); ledcWrite(0, 0); 
  Serial.println("🛑 หยุดการทำงานมอเตอร์แล้ว");
  
  // รอให้ตาชั่งนิ่งสักพัก
  delay(1000); 
  
  float weightAfterFeed = scale.is_ready() ? scale.get_units(5) : 0.0;
  if (weightAfterFeed < 0) weightAfterFeed = 0.0;
  
  float dispensed = weightBeforeFeed - weightAfterFeed;
  
  Serial.printf("📊 น้ำหนักก่อน: %.1f กรัม | หลัง: %.1f กรัม | จ่ายไป: %.1f กรัม\n", weightBeforeFeed, weightAfterFeed, dispensed);

  char timeStr[32] = "Unknown Time";
  if (Rtc.GetIsRunning()) {
      RtcDateTime now = Rtc.GetDateTime();
      snprintf(timeStr, sizeof(timeStr), "%04d-%02d-%02dT%02d:%02d:%02d+07:00", 
               now.Year(), now.Month(), now.Day(), now.Hour(), now.Minute(), now.Second());
  }
  if (historyCount < MAX_HISTORY) {
      feedHistory[historyCount] = { String(timeStr), (int)dispensed, currentFeedMode };
      historyCount++;
  } else {
      for (int i = 1; i < MAX_HISTORY; i++) feedHistory[i-1] = feedHistory[i];
      feedHistory[MAX_HISTORY-1] = { String(timeStr), (int)dispensed, currentFeedMode };
  }
  saveHistoryToSPIFFS();
  Serial.println("📝 บันทึกประวัติการให้อาหารลง Memory สำเร็จ");
  
  if (WiFi.status() == WL_CONNECTED && mqttClient.connected()) {
    publishMQTTStatus();
    
    DynamicJsonDocument histDoc(2048);
    JsonArray array = histDoc.to<JsonArray>();
    for (int i = historyCount - 1; i >= 0; i--) {
      JsonObject obj = array.createNestedObject();
      obj["timestamp"] = feedHistory[i].timestamp;
      obj["amount"] = feedHistory[i].amount;
      obj["mode"] = feedHistory[i].mode;
    }
    String historyPayload;
    serializeJson(histDoc, historyPayload);
    String historyTopic = "fishfeeder/" + deviceId + "/history";
    bool pubSuccess = mqttClient.publish(historyTopic.c_str(), historyPayload.c_str(), true); // Retained
    Serial.print("📢 ส่งข้อมูลประวัติขึ้น MQTT: ");
    Serial.println(pubSuccess ? "✅ สำเร็จ!" : "❌ ล้มเหลว!");
  }
}

// =================================================================
// 📌 12. API คืนค่าสถานะและน้ำหนัก (รองรับ current_weight ตาม app.js)[cite: 2]
// =================================================================
void handleApiStatus() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  
  bool scaleReady = scale.wait_ready_timeout(100);
  float weight = scaleReady ? scale.get_units(3) : 0.0;
  if (weight < 0) weight = 0.0; 

  // ใช้ตัวแปร forceManualMode จริงๆ แทนการดูจาก schedule
  String currentMode = forceManualMode ? "MANUAL" : "AUTO";

  StaticJsonDocument<256> doc;
  doc["online"] = true;
  doc["current_weight"] = weight;
  doc["weight"]         = weight;   
  doc["weight_grams"]   = weight; 
  doc["status"]         = isFeeding ? "FEEDING" : "IDLE";
  doc["motor_status"]   = isFeeding ? "FEEDING" : "READY";
  doc["scale_status"]   = scaleReady ? "NORMAL" : "ERROR";
  doc["mode"] = currentMode;
  doc["motor_speed"] = currentMotorSpeed;
  doc["schedule_count"] = scheduleCount;

  String response;
  serializeJson(doc, response);
  server.send(200, "application/json", response);
}

// =================================================================
// 📌 13. API สั่งให้อาหาร
// =================================================================
void handleLocalFeed() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  
  int amount = 10;
  if (server.hasArg("amount")) {
    amount = server.arg("amount").toInt();
  } else if (server.hasArg("grams")) {
    amount = server.arg("grams").toInt();
  }
  if (amount <= 0) amount = 10;
  
  triggerFeeding(amount, "manual");
  
  String response = "{\"success\":true,\"message\":\"กำลังปล่อยอาหาร " + String(amount) + " กรัม\"}";
  server.send(200, "application/json", response);
}

// =================================================================
// 📌 13.5. API เปลี่ยนโหมด
// =================================================================
void handleSetMode() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  if(server.hasArg("manual")) {
    forceManualMode = (server.arg("manual") == "1" || server.arg("manual") == "true");
    saveModeSettings();
  }
  publishMQTTStatus();
  server.send(200, "application/json", "{\"success\":true}");
}

// =================================================================
// 📌 13.6. API ตั้งเวลา (Sync เวลาจาก Browser ไปยัง RTC สำหรับ Local Mode)
// =================================================================
void handleSetTime() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  if (server.hasArg("plain")) {
    String body = server.arg("plain");
    StaticJsonDocument<256> doc;
    DeserializationError error = deserializeJson(doc, body);
    if (!error) {
      int y = doc["year"] | 2026;
      int m = doc["month"] | 1;
      int d = doc["day"] | 1;
      int h = doc["hour"] | 0;
      int min = doc["minute"] | 0;
      int s = doc["second"] | 0;

      RtcDateTime compiled = RtcDateTime(y, m, d, h, min, s);
      Rtc.SetDateTime(compiled);
      Serial.printf("🕒 บันทึกเวลาลง RTC จาก Browser: %04d-%02d-%02d %02d:%02d:%02d\n", y, m, d, h, min, s);
      
      server.send(200, "application/json", "{\"success\":true}");
      return;
    }
  }
  server.send(400, "application/json", "{\"success\":false}");
}

// =================================================================
// 📌 14. API หยุดฉุกเฉิน
// =================================================================
void handleLocalStop() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  stopFeeding(); 
  
  String response = "{\"success\":true,\"message\":\"หยุดทำงานฉุกเฉินเรียบร้อย\"}";
  server.send(200, "application/json", response);
}

// =================================================================
// 📌 14.5 API ระบบชั่งน้ำหนัก (Tare / Calibrate)
// =================================================================
void handleLocalTare() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  scale.tare();
  String response = "{\"success\":true,\"message\":\"ปรับศูนย์ตาชั่งสำเร็จ\"}";
  server.send(200, "application/json", response);
}

void handleLocalCalibrate() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  float factor = 220.4;
  if (server.hasArg("weight")) {
    float known_weight = server.arg("weight").toFloat();
    if (known_weight > 0) {
      // 1. Get current reading (average of 10)
      long reading = scale.get_value(10);
      // 2. Calculate new factor
      factor = (float)reading / known_weight;
      scale.set_scale(factor);
      
      // Save to preferences
      preferences.begin("scale_config", false);
      preferences.putFloat("calib_factor", factor);
      preferences.end();
    }
  }
  
  String response = "{\"success\":true,\"message\":\"ตั้งค่า Calibration สำเร็จ\",\"factor\":" + String(factor) + "}";
  server.send(200, "application/json", response);
}

// =================================================================
// 📌 15. API บันทึก Wi-Fi บ้าน
// =================================================================
void handleSaveWifi() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  String ssid = server.hasArg("ssid") ? server.arg("ssid") : "";
  String pass = server.hasArg("pass") ? server.arg("pass") : "";

  if (ssid.length() > 0) {
    preferences.begin("wifi_config", false);
    preferences.putString("ssid", ssid);
    preferences.putString("pass", pass);
    preferences.end();

    server.send(200, "application/json", "{\"success\":true,\"message\":\"บันทึก Wi-Fi เรียบร้อย! ESP32 กำลังรีบูต...\"}");
    delay(1000);
    ESP.restart(); 
  } else {
    server.send(400, "application/json", "{\"success\":false,\"message\":\"กรุณาระบุชื่อ SSID\"}");
  }
}

// =================================================================
// 📌 16. API บันทึก Wi-Fi AP ของเครื่อง
// =================================================================
void handleSaveApWifi() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  String apSsid = server.hasArg("apSsid") ? server.arg("apSsid") : "";
  String apPass = server.hasArg("apPass") ? server.arg("apPass") : "";

  preferences.begin("wifi_config", false);
  if (apSsid.length() > 0) preferences.putString("ap_ssid", apSsid);
  if (apPass.length() >= 8) preferences.putString("ap_pass", apPass);
  preferences.end();

  server.send(200, "application/json", "{\"success\":true,\"message\":\"บันทึกค่า AP WiFi เรียบร้อย! ESP32 กำลังรีบูต...\"}");
  delay(1000);
  ESP.restart();
}

// =================================================================
// 📌 17. API รีเซ็ต / ล้างค่า Wi-Fi
// =================================================================
void handleResetWifi() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  preferences.begin("wifi_config", false);
  preferences.clear(); 
  preferences.end();

  server.send(200, "application/json", "{\"success\":true,\"message\":\"ล้างค่าเครือข่ายเรียบร้อย\"}");
  delay(1000);
  ESP.restart();
}

// =================================================================
// 📌 API ประวัติการทำงาน (History)
// =================================================================
void handleGetHistory() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  DynamicJsonDocument doc(1024);
  JsonArray array = doc.to<JsonArray>();
  for (int i = historyCount - 1; i >= 0; i--) {
    JsonObject obj = array.createNestedObject();
    obj["timestamp"] = feedHistory[i].timestamp;
    obj["amount"] = feedHistory[i].amount;
    obj["mode"] = feedHistory[i].mode;
  }
  String response;
  serializeJson(doc, response);
  server.send(200, "application/json", response);
}

void handleClearHistory() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  historyCount = 0;
  saveHistoryToSPIFFS();
  
  if (WiFi.status() == WL_CONNECTED && mqttClient.connected()) {
      String historyTopic = "fishfeeder/" + deviceId + "/history";
      mqttClient.publish(historyTopic.c_str(), "[]", true);
  }
  server.send(200, "application/json", "{\"status\":\"success\"}");
}

// =================================================================
// 📌 18. API สแกนหา Wi-Fi รอบตัว
// =================================================================
void handleScanWifi() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  int n = WiFi.scanNetworks();
  String json = "[";
  for (int i = 0; i < n; ++i) {
    if (i > 0) json += ",";
    json += "\"" + WiFi.SSID(i) + "\"";
  }
  json += "]";
  server.send(200, "application/json", json);
}

// =================================================================
// 📌 19. ระบบตารางเวลา (Schedule)
// =================================================================
void updateLocalSchedulesFromJson(String json) {
  DynamicJsonDocument doc(1024);
  DeserializationError error = deserializeJson(doc, json);
  if (error) {
    Serial.println("❌ Parse Schedule JSON Failed");
    return;
  }
  
  // Save to SPIFFS
  File file = SPIFFS.open("/schedules.json", FILE_WRITE);
  if (file) {
    file.print(json);
    file.close();
  }

  // If the JSON is wrapped in {"schedules": [...]}, extract it
  JsonArray arr;
  if (doc.containsKey("schedules")) {
    arr = doc["schedules"].as<JsonArray>();
  } else {
    arr = doc.as<JsonArray>();
  }

  scheduleCount = 0;
  for (JsonVariant v : arr) {
    if (scheduleCount >= 4) break;
    String timeStr = v["time"].as<String>();
    int hour = timeStr.substring(0, 2).toInt();
    int min = timeStr.substring(3, 5).toInt();
    int amount = v["amount"].as<int>();
    bool enable = v["enable"].as<bool>();
    
    localSchedules[scheduleCount].hour = hour;
    localSchedules[scheduleCount].minute = min;
    localSchedules[scheduleCount].amount = amount;
    localSchedules[scheduleCount].enable = enable;
    
    Serial.printf("⏰ ตารางเวลา %d: %02d:%02d | %d กรัม | สถานะ: %s\n", 
      scheduleCount+1, hour, min, amount, enable ? "เปิด" : "ปิด");
      
    scheduleCount++;
  }
  Serial.printf("✅ อัปเดตตารางเวลารวม %d รายการ\n", scheduleCount);
}

void loadSchedules() {
  if (SPIFFS.exists("/schedules.json")) {
    File file = SPIFFS.open("/schedules.json", FILE_READ);
    if (file) {
      String json = file.readString();
      file.close();
      updateLocalSchedulesFromJson(json);
    }
  }
}

void saveHistoryToSPIFFS() {
  DynamicJsonDocument doc(2048);
  JsonArray array = doc.to<JsonArray>();
  for (int i = 0; i < historyCount; i++) {
    JsonObject obj = array.createNestedObject();
    obj["timestamp"] = feedHistory[i].timestamp;
    obj["amount"] = feedHistory[i].amount;
    obj["mode"] = feedHistory[i].mode;
  }
  File file = SPIFFS.open("/history.json", FILE_WRITE);
  if (file) {
    serializeJson(doc, file);
    file.close();
  }
}

void loadHistoryFromSPIFFS() {
  if (SPIFFS.exists("/history.json")) {
    File file = SPIFFS.open("/history.json", FILE_READ);
    if (file) {
      DynamicJsonDocument doc(2048);
      DeserializationError error = deserializeJson(doc, file);
      if (!error) {
        historyCount = 0;
        JsonArray array = doc.as<JsonArray>();
        for (JsonObject obj : array) {
          if (historyCount < MAX_HISTORY) {
            feedHistory[historyCount].timestamp = obj["timestamp"].as<String>();
            feedHistory[historyCount].amount = obj["amount"].as<int>();
            feedHistory[historyCount].mode = obj["mode"].as<String>();
            historyCount++;
          }
        }
      }
      file.close();
    }
  }
}

void handleGetSchedule() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  if (SPIFFS.exists("/schedules.json")) {
    File file = SPIFFS.open("/schedules.json", FILE_READ);
    String json = file.readString();
    file.close();
    server.send(200, "application/json", json);
  } else {
    server.send(200, "application/json", "[]");
  }
}

void handlePostSchedule() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  if (server.hasArg("plain")) {
    String json = server.arg("plain");
    updateLocalSchedulesFromJson(json);
    
    if (mqttClient.connected()) {
      String syncTopic = "fishfeeder/" + deviceId + "/schedule";
      mqttClient.publish(syncTopic.c_str(), json.c_str(), true); // retain=true
      Serial.println("🔄 ส่งอัปเดตตารางเวลาไปยังระบบออนไลน์ (MQTT) แล้ว");
    }
    
    server.send(200, "application/json", "{\"success\":true}");
  } else {
    server.send(400, "application/json", "{\"success\":false}");
  }
}

// =================================================================
// 📌 20. API ดัมบ์ข้อมูลกันหน้าเว็บค้าง (Dummy Handlers)
// =================================================================
void handleDummyEmptyArray() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", "[]");
}

void handleDummySuccess() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", "{\"success\":true}");
}

// =================================================================
// 🛠️ 20. ฟังก์ชันรับคำสั่งผ่าน Serial Monitor
// =================================================================
void testMotorSerial() {
  if (Serial.available() > 0) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    
    if (cmd == "1") {
      Serial.println("\n------------------------------------------");
      Serial.println("🛠️ [TEST MODE] ได้รับคำสั่ง '1'");
      Serial.println("⚙️ กำลังเทสมอเตอร์หมุน...");
      Serial.println("------------------------------------------");
      triggerFeeding(10); 
    } 
    else if (cmd == "0") {
      Serial.println("\n🛑 [TEST MODE] สั่งหยุดมอเตอร์ทันที!");
      stopFeeding();
    }
    else if (cmd == "2") {
      Serial.println("\n⚡ [TEST MODE] เปิดรีเลย์ค้าง (ทดสอบขั้วไฟ)");
      /* L298N test */ 
    }
    else if (cmd.equalsIgnoreCase("reset")) {
      Serial.println("\n⚠️ [COMMAND] กำลังรีเซ็ตการตั้งค่า Wi-Fi ทั้งหมด...");
      preferences.begin("wifi_config", false);
      preferences.clear(); 
      preferences.end();
      Serial.println("✅ ล้างค่าเรียบร้อย! ESP32 จะกลับไปเป็นโหมด AP (ไม่มีรหัส) ทันทีที่รีบูต...");
      delay(1000);
      ESP.restart();
    }
  }
}
void handleSetSpeed() {
  if (server.hasArg("speed")) {
    currentMotorSpeed = server.arg("speed").toInt();
    if(currentMotorSpeed < 0) currentMotorSpeed = 0;
    if(currentMotorSpeed > 100) currentMotorSpeed = 100;
    preferences.begin("motor_config", false);
    preferences.putInt("speed", currentMotorSpeed);
    preferences.end();
    server.send(200, "application/json", "{\"success\":true,\"message\":\"Speed updated\"}");
  } else {
    server.send(400, "application/json", "{\"success\":false,\"message\":\"Missing speed\"}");
  }
}
