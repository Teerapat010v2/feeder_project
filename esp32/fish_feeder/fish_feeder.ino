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
#include "secrets.h"

// =================================================================
// 📌 1. โซนตั้งค่าพินฮาร์ดแวร์ (HARDWARE PIN CONFIG)
// =================================================================
#define HX711_DT   16   
#define HX711_SCK  17   
#define RELAY_PIN  18   

#define LED_R      19   
#define LED_G      23   
#define LED_B      25   

// =================================================================
// 📌 2. โซนปรับแต่งค่าการทำงาน (ADJUSTABLE PARAMETERS)
// =================================================================
#define CALIBRATION_FACTOR 220.4  

#define RELAY_ON   LOW
#define RELAY_OFF  HIGH

// =================================================================
// 📌 3. ประกาศตัวแปรและออบเจ็กต์ของระบบ (SYSTEM OBJECTS)
// =================================================================
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

// --- ประกาศชื่อฟังก์ชันล่วงหน้า (Function Prototypes) ---
void triggerFeeding(int amountGrams);
void stopFeeding();
void handleApiStatus();
void handleLocalFeed();
void handleLocalStop();
void handleSaveWifi();
void handleSaveApWifi();
void handleResetWifi();
void handleScanWifi();
void handleDummyEmptyArray();
void handleDummySuccess();
bool handleFileRead(String path);
void setRGB(bool r, bool g, bool b);
void testMotorSerial();

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
      triggerFeeding(amount);
    } else if (strcmp(action, "EMERGENCY_STOP") == 0) {
      stopFeeding();
    }
  }
}

void connectMQTT() {
  if (WiFi.status() != WL_CONNECTED) return;
  
  while (!mqttClient.connected()) {
    Serial.print("📡 กำลังเชื่อมต่อ MQTT (HiveMQ)... ");
    if (mqttClient.connect(deviceId.c_str(), MQTT_USER, MQTT_PASS)) {
      Serial.println("✅ เชื่อมต่อ MQTT สำเร็จ");
      String cmdTopic = "fishfeeder/" + deviceId + "/cmd/#";
      mqttClient.subscribe(cmdTopic.c_str());
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

  // กำหนดชื่อบอร์ดเป็น Prototype_01 ตามที่ระบุ (ไม่สามารถแก้ไขได้)
  deviceId = "Prototype_01";
  
  Serial.println("\n--- [ESP32 Smart Fish Feeder Starting] ---");
  Serial.print("Device ID: ");
  Serial.println(deviceId);

  pinMode(RELAY_PIN, OUTPUT);
  pinMode(LED_R, OUTPUT);
  pinMode(LED_G, OUTPUT);
  pinMode(LED_B, OUTPUT);

  digitalWrite(RELAY_PIN, RELAY_OFF);
  setRGB(false, false, true); 

  if (!SPIFFS.begin(true)) {
    Serial.println("❌ SPIFFS Mount Failed! กรุณาอัปโหลดโฟลเดอร์ data");
    return;
  }
  Serial.println("✅ SPIFFS Mounted Successfully");

  preferences.begin("scale_config", true);
  float calib = preferences.getFloat("calib_factor", 220.4);
  preferences.end();
  scale.begin(HX711_DT, HX711_SCK);
  scale.set_scale(calib);
  scale.tare(); 
  Serial.println("✅ HX711 Loadcell Ready");

  WiFi.mode(WIFI_AP_STA);
  
  espClient.setInsecure(); // ไม่ตรวจสอบ SSL Cert
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  
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
  
  // เส้นทางหน้า Settings และ Wi-Fi
  server.on("/api/save-wifi", handleSaveWifi);   
  server.on("/api/save-ap", handleSaveApWifi);
  server.on("/api/reset-wifi", handleResetWifi); 
  server.on("/api/scan-wifi", handleScanWifi);   

  // Endpoint ป้องกันหน้าเว็บค้าง
  server.on("/api/verify", HTTP_POST, handleDummySuccess);
  server.on("/api/history", HTTP_GET, handleDummyEmptyArray);
  server.on("/api/history", HTTP_DELETE, handleDummySuccess);
  server.on("/api/alerts", HTTP_GET, handleDummyEmptyArray);
  server.on("/api/schedule", HTTP_GET, handleDummyEmptyArray);
  server.on("/api/schedule", HTTP_POST, handleDummySuccess);
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
    float weight = scale.is_ready() ? scale.get_units(3) : 0.0;
    if (weight < 0) weight = 0.0;
    
    StaticJsonDocument<200> doc;
    doc["online"] = true;
    doc["weight"] = weight;
    doc["current_weight"] = weight;
    doc["status"] = isFeeding ? "FEEDING" : "IDLE";
    doc["deviceId"] = deviceId;
    
    String payload;
    serializeJson(doc, payload);
    
    String statusTopic = "fishfeeder/" + deviceId + "/status";
    // ใส่ true ตัวสุดท้ายเพื่อให้ Broker จำค่าล่าสุดไว้ (Retained Message)
    // ทำให้เวลาเปิดหน้าเว็บใหม่ จะเห็นค่าทันทีไม่ต้องรอรอบส่ง!
    mqttClient.publish(statusTopic.c_str(), payload.c_str(), true); 
}

// =================================================================
// 📌 9. ฟังก์ชันการทำงานหลัก LOOP
// =================================================================
void loop() {
  testMotorSerial();              

  dnsServer.processNextRequest(); 
  server.handleClient();          

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

  yield(); 
}

// =================================================================
// 📌 10. ฟังก์ชันสั่งเปิดรีเลย์มอเตอร์
// =================================================================
void triggerFeeding(int amountGrams) {
  if (isFeeding) return; 

  unsigned long duration = (unsigned long)((amountGrams / 10.0) * 2000.0);
  if (duration < 1000) duration = 1000;
  
  feedDuration = duration;
  feedStartTime = millis();
  isFeeding = true;

  digitalWrite(RELAY_PIN, RELAY_ON);
  
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
void stopFeeding() {
  isFeeding = false;
  digitalWrite(RELAY_PIN, RELAY_OFF); 
  Serial.println("🛑 หยุดการทำงานมอเตอร์แล้ว");
  
  if (WiFi.status() == WL_CONNECTED && mqttClient.connected()) {
    publishMQTTStatus();
  }
}

// =================================================================
// 📌 12. API คืนค่าสถานะและน้ำหนัก (รองรับ current_weight ตาม app.js)[cite: 2]
// =================================================================
void handleApiStatus() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  
  float weight = scale.is_ready() ? scale.get_units(3) : 0.0;
  if (weight < 0) weight = 0.0; 

  StaticJsonDocument<200> doc;
  doc["online"] = true;
  doc["current_weight"] = weight;   // 🟢 ตรงกับ app.js บรรทัดที่ 17[cite: 2]
  doc["weight"]         = weight;   
  doc["weight_grams"]   = weight; 
  doc["status"]         = isFeeding ? "FEEDING" : "IDLE";

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
  
  triggerFeeding(amount);
  
  String response = "{\"success\":true,\"message\":\"กำลังปล่อยอาหาร " + String(amount) + " กรัม\"}";
  server.send(200, "application/json", response);
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
// 📌 19. API ดัมบ์ข้อมูลกันหน้าเว็บค้าง (Dummy Handlers)
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
      digitalWrite(RELAY_PIN, !digitalRead(RELAY_PIN)); 
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