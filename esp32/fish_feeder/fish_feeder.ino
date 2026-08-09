#include <WiFi.h>
#include <WebServer.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <FirebaseESP32.h>     // คลังไลบรารี Firebase สำหรับ ESP32
#include <ArduinoJson.h>
#include <Wire.h>
#include <WiFiManager.h>
#include "HX711.h"
#include <RtcDS1302.h>
#include <ThreeWire.h>
#include "secrets.h"

// --- 📌 Pin Configurations (ESP32 30P Expansion Board) ---
#define HX711_DT   16
#define HX711_SCK  17
#define RELAY_PIN  18

// 🔴🟢🔵 RGB LED Pins (Common Cathode - ขาลบต่อ GND)
#define LED_R      19
#define LED_G      23
#define LED_B      25

// 🕒 RTC DS1302 Pins
#define RTC_RST    14
#define RTC_DAT    21
#define RTC_CLK    22

// --- ⚙️ Calibration Values ---
#define CALIBRATION_FACTOR 220.4

// --- Objects ---
HX711 scale;
WiFiClientSecure espClient;
PubSubClient client(espClient);
WebServer server(80);           
WiFiManager wm;
ThreeWire myWire(RTC_DAT, RTC_CLK, RTC_RST); // (DAT, CLK, RST)
RtcDS1302<ThreeWire> myRTC(myWire);

// 🔥 Firebase Objects
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

// --- MQTT Topics ---
String subFeedTopic   = "fishfeeder/" + String(DEVICE_ID) + "/cmd/feed";
String subStopTopic   = "fishfeeder/" + String(DEVICE_ID) + "/cmd/stop";
String pubStatusTopic = "fishfeeder/" + String(DEVICE_ID) + "/status";
String pubWeightTopic = "fishfeeder/" + String(DEVICE_ID) + "/weight";

// Timers & State Variables
unsigned long lastWeightReport = 0;
const long reportInterval = 2000; // รายงานค่าน้ำหนักทุก 5 วินาที
unsigned long lastFbCheck = 0;    // ตัวจับเวลาเช็ก Firebase

bool isFeeding = false;
unsigned long feedStartTime = 0;
unsigned long feedDuration = 0;

// Function Declarations
void setupWiFi();
void setupFirebase();
void reconnectMQTT();
void callback(char* topic, byte* payload, unsigned int length);
void triggerFeeding(int amountGrams);
void stopFeeding();
void emergencyStop();
void publishStatus(String state, String msg);
void readAndReportWeight(bool isWifiConnected);
void checkFirebaseCommands();
void handleLocalFeed();
void handleLocalStop();
void bindServerCallback();
void sendCustomUI(WebServer *srv);
void setRGB(bool r, bool g, bool b);

// ----------------------------------------------------
// 🎨 หน้า Web UI แบบ Custom (Local Page)
// ----------------------------------------------------
const char PAGE_LOCAL_UI[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ควบคุมแบบ Local (ESP32)</title>
  <style>
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { background-color: #f0f2f5; margin: 0; padding: 20px; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
    .card { background: #ffffff; border-radius: 16px; padding: 32px 24px; width: 100%; max-width: 420px; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
    .title { font-size: 22px; font-weight: bold; color: #1a1a1a; margin-bottom: 8px; }
    .subtitle { font-size: 14px; color: #65676b; margin-bottom: 24px; }
    .form-group { text-align: left; margin-bottom: 16px; }
    .form-group label { font-size: 13px; font-weight: 600; color: #444; }
    .input-amount { width: 100%; padding: 10px 12px; margin-top: 6px; border: 1px solid #ced4da; border-radius: 8px; font-size: 15px; outline: none; }
    .btn { display: block; width: 100%; padding: 14px; border: none; border-radius: 10px; font-size: 16px; font-weight: bold; cursor: pointer; text-decoration: none; text-align: center; margin-bottom: 12px; transition: background 0.2s; }
    .btn-blue { background-color: #007bff; color: white; }
    .btn-blue:hover { background-color: #0056b3; }
    .btn-red { background-color: #dc3545; color: white; }
    .btn-red:hover { background-color: #a71d2a; }
    .btn-grey { background-color: #6c757d; color: white; }
    .btn-grey:hover { background-color: #545b62; }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">🐟 ควบคุมแบบ Local (ESP32)</div>
    <div class="subtitle">เชื่อมต่อตรงกับเครื่องให้อาหารปลา</div>
    
    <form action="/local-feed" method="GET">
      <div class="form-group">
        <label>ระบุปริมาณอาหาร (กรัม):</label>
        <input type="number" name="amount" class="input-amount" value="10" min="1" max="500" required>
      </div>
      <button type="submit" class="btn btn-blue">🐟 สั่งให้อาหารทันที</button>
    </form>

    <a href="/local-stop" class="btn btn-red">🛑 หยุดฉุกเฉิน (Stop)</a>
    <a href="/wifi" class="btn btn-grey">⚙️ ตั้งค่าเชื่อมต่อ Wi-Fi บ้าน</a>
  </div>
</body>
</html>
)rawliteral";

// ฟังก์ชันเปิด-ปิดไฟ RGB LED (r, g, b)
void setRGB(bool r, bool g, bool b) {
  digitalWrite(LED_R, r ? HIGH : LOW);
  digitalWrite(LED_G, g ? HIGH : LOW);
  digitalWrite(LED_B, b ? HIGH : LOW);
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n--- [ESP32 System Initialization] ---");

  // ตั้งค่า Pin Output
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(LED_R, OUTPUT);
  pinMode(LED_G, OUTPUT);
  pinMode(LED_B, OUTPUT);

  digitalWrite(RELAY_PIN, HIGH); // Active LOW -> ปิด Relay ทันทีเมื่อเปิดเครื่อง
  setRGB(true, false, false);   // 🔴 เริ่มต้นแสดงสีแดง (กำลังเปิดเครื่อง)

  // ตั้งค่า RTC DS1302
  myRTC.Begin();

  // ตั้งค่า Load Cell HX711
  scale.begin(HX711_DT, HX711_SCK);
  scale.set_scale(CALIBRATION_FACTOR);
  scale.tare();

  // 1. ตั้งค่า Wi-Fi (ล้างรหัสผ่านเก่า บังคับให้ผู้ใช้ใส่ Wi-Fi ใหม่ทุกครั้ง)
  setupWiFi();

  // 🕒 2. ซิงค์เวลาโลก NTP เพื่อความเสถียรของ SSL
  configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[NTP] Syncing time");
    struct tm timeinfo;
    int retry = 0;
    while (!getLocalTime(&timeinfo) && retry < 10) {
      Serial.print(".");
      delay(300);
      retry++;
    }
    Serial.println(" Done!");
  }

  // 3. ตั้งค่า Local Web Server
  server.on("/", []() { sendCustomUI(&server); });
  server.on("/local", []() { sendCustomUI(&server); });
  server.on("/local-feed", handleLocalFeed);
  server.on("/local-stop", handleLocalStop);
  server.begin();

  // 4. ตั้งค่า MQTT
  espClient.setInsecure();
  client.setServer(MQTT_HOST, MQTT_PORT);
  client.setCallback(callback);
  client.setBufferSize(512);

  // 5. ตั้งค่า Firebase
  setupFirebase();

  setRGB(false, false, true); // 🔵 ตั้งค่าสำเร็จ แสดงสีน้ำเงิน (พร้อมใช้งาน)
  Serial.println("--- [System Ready] ---");
}

void loop() {
  wm.process(); // คอยรัน WiFiManager AP

  unsigned long currentMillis = millis();
  bool isWifiConnected = (WiFi.status() == WL_CONNECTED);

  // 1. ตรวจจับสถานะการเชื่อมต่อ Wi-Fi
  static bool lastWifiConnected = false;
  if (isWifiConnected != lastWifiConnected) {
    lastWifiConnected = isWifiConnected;
    if (isWifiConnected) {
      Serial.print("\n[WiFi] Connected! Local IP: ");
      Serial.println(WiFi.localIP());
      setRGB(false, false, true); // 🔵 เชื่อมต่อสำเร็จ แสดงสีน้ำเงิน
    } else {
      Serial.println("\n[WiFi] Disconnected! AP Mode Active");
      setRGB(true, false, false); // 🔴 หลุดการเชื่อมต่อ แสดงสีแดง
    }
  }

  // 2. จัดการ Web Server, MQTT และ Firebase เมื่อมีอินเทอร์เน็ต
  if (isWifiConnected) {
    server.handleClient();

    if (!client.connected()) {
      reconnectMQTT();
    } else {
      client.loop();
    }

    checkFirebaseCommands();
  }

  // 3. ระบบนับเวลาปิดมอเตอร์ให้อาหาร
  if (isFeeding) {
    setRGB(false, true, false); // 🟢 มอเตอร์ทำงาน แสดงสีเขียว
    if (currentMillis - feedStartTime >= feedDuration) {
      stopFeeding();
      Serial.println("[Status] Feeding Complete -> Motor STOP");
      setRGB(false, false, true); // 🔵 ทำงานเสร็จ กลับเป็นสีน้ำเงิน
      if (isWifiConnected) {
        publishStatus("IDLE", "Feeding complete");
      }
    }
  }

  // 4. อ่านค่าน้ำหนักและรายงานผลทุกๆ 5 วินาที
  if (currentMillis - lastWeightReport >= reportInterval) {
    lastWeightReport = currentMillis;
    readAndReportWeight(isWifiConnected);
  }

  yield();
}

// ----------------------------------------------------
// 🔥 ตั้งค่า Firebase
// ----------------------------------------------------
void setupFirebase() {
  config.host = FIREBASE_HOST;
  config.signer.tokens.legacy_token = FIREBASE_AUTH;

  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);
  fbdo.setResponseSize(1024);
  Serial.println("[Firebase] Initialized Successfully!");
}

// ----------------------------------------------------
// 📶 ตั้งค่า WiFiManager (บังคับตั้ง Wi-Fi ใหม่ + Redirect ไป Vercel ใน 3 วินาที)
// ----------------------------------------------------
void setupWiFi() {
  String dashboardUrl = "https://feederproject.vercel.app/"; 

  // 🟢 ล้างค่า Wi-Fi เดิมทิ้งทุกครั้งที่เปิดเครื่องใหม่ เพื่อบังคับเข้า AP Mode
  wm.resetSettings();

  wm.setDebugOutput(false);
  wm.setConfigPortalBlocking(false);
  wm.setWebServerCallback(bindServerCallback);

  // 🟢 สคริปต์นับถอยหลัง 3 วินาทีแล้วเด้งไปหน้าเว็บ Vercel ทันทีหลังกด Save
  String customHead = "<script>"
                      "window.addEventListener('DOMContentLoaded', function() {"
                      "  if (window.location.pathname.indexOf('/wifisave') !== -1) {"
                      "    var body = document.body;"
                      "    body.innerHTML = '<div style=\"text-align:center;padding:50px;font-family:sans-serif;\">"
                      "<h2>✅ บันทึก Wi-Fi เรียบร้อย!</h2>"
                      "<p>กำลังนำคุณไปยังหน้าควบคุม Vercel ใน <b>3 วินาที</b>...</p></div>';"
                      "    setTimeout(function(){ window.location.href = '" + dashboardUrl + "'; }, 3000);"
                      "  }"
                      "});"
                      "</script>";
  wm.setCustomHeadElement(customHead.c_str());

  if (wm.autoConnect("FishFeeder-Setup")) {
    Serial.println("[WiFi] Connected to network successfully!");
  } else {
    Serial.println("[WiFi] AP Mode Active -> SSID: 'FishFeeder-Setup' (192.168.4.1)");
  }
}

void sendCustomUI(WebServer *srv) {
  srv->send(200, "text/html", PAGE_LOCAL_UI);
}

void bindServerCallback() {
  wm.server->on("/", []() { sendCustomUI(wm.server.get()); });
  wm.server->on("/local", []() { sendCustomUI(wm.server.get()); });

  wm.server->on("/local-feed", []() {
    int amount = 10;
    if (wm.server->hasArg("amount")) {
      amount = wm.server->arg("amount").toInt();
    }
    if (amount <= 0) amount = 10;
    
    triggerFeeding(amount);
    
    String html = "<html><head><meta name='viewport' content='width=device-width, initial-scale=1'><meta charset='UTF-8'></head>"
                  "<body style='text-align:center;font-family:sans-serif;padding-top:50px;background:#f0f2f5;'>"
                  "<div style='background:white;padding:30px;border-radius:16px;max-width:320px;margin:auto;box-shadow:0 4px 20px rgba(0,0,0,0.06);'>"
                  "<h2 style='color:#28a745;'>✅ สั่งให้อาหาร " + String(amount) + " กรัม สำเร็จ!</h2>"
                  "<br/><a href='/local' style='background:#007bff;color:white;padding:12px 20px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold;'>กลับหน้าหลัก</a>"
                  "</div></body></html>";
    wm.server->send(200, "text/html", html);
  });

  wm.server->on("/local-stop", []() {
    emergencyStop();
    
    String html = "<html><head><meta name='viewport' content='width=device-width, initial-scale=1'><meta charset='UTF-8'></head>"
                  "<body style='text-align:center;font-family:sans-serif;padding-top:50px;background:#f0f2f5;'>"
                  "<div style='background:white;padding:30px;border-radius:16px;max-width:320px;margin:auto;box-shadow:0 4px 20px rgba(0,0,0,0.06);'>"
                  "<h2 style='color:#dc3545;'>🛑 สั่งหยุดฉุกเฉินเรียบร้อย!</h2>"
                  "<br/><a href='/local' style='background:#007bff;color:white;padding:12px 20px;text-decoration:none;border-radius:8px;display:inline-block;font-weight:bold;'>กลับหน้าหลัก</a>"
                  "</div></body></html>";
    wm.server->send(200, "text/html", html);
  });
}

void handleLocalFeed() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  int amount = 10;
  if (server.hasArg("amount")) {
    amount = server.arg("amount").toInt();
  }
  if (amount <= 0) amount = 10;
  
  triggerFeeding(amount);
  server.send(200, "application/json", "{\"success\":true,\"message\":\"Local feed executed\"}");
}

void handleLocalStop() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  emergencyStop();
  server.send(200, "application/json", "{\"success\":true,\"message\":\"Local stop executed\"}");
}

// ----------------------------------------------------
// 🔄 เชื่อมต่อ MQTT
// ----------------------------------------------------
void reconnectMQTT() {
  static unsigned long lastReconnectAttempt = 0;
  unsigned long now = millis();

  if (!client.connected() && (now - lastReconnectAttempt > 5000)) {
    lastReconnectAttempt = now;
    Serial.print("[MQTT] Connecting...");
    String clientId = "ESP32Client-" + String(DEVICE_ID) + "-" + String(random(0xffff), HEX);

    if (client.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
      Serial.println(" SUCCESS!");
      client.subscribe(subFeedTopic.c_str());
      client.subscribe(subStopTopic.c_str());
      publishStatus("ONLINE", "Connected & Ready");
    } else {
      Serial.printf(" FAILED (rc=%d)\n", client.state());
    }
  }
}

void callback(char* topic, byte* payload, unsigned int length) {
  String incomingTopic = String(topic);
  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, payload, length)) return;

  if (incomingTopic == subFeedTopic) {
    int amount = doc["amount"] | 10;
    triggerFeeding(amount);
  } else if (incomingTopic == subStopTopic) {
    emergencyStop();
  }
}

// ----------------------------------------------------
// ⚙️ กลไกสั่งให้อาหาร & หยุด
// ----------------------------------------------------
void triggerFeeding(int amountGrams) {
  if (isFeeding) return;

  Serial.printf("[Action] Dispensing %d grams...\n", amountGrams);

  unsigned long duration = (unsigned long)((amountGrams / 10.0) * 2000.0);
  if (duration < 1000) duration = 1000;
  feedDuration = duration;

  if (WiFi.status() == WL_CONNECTED) {
    publishStatus("FEEDING", "Dispensing food...");
  }

  digitalWrite(RELAY_PIN, LOW);  // เปิด Relay (Active LOW)
  feedStartTime = millis();
  isFeeding = true;
}

void stopFeeding() {
  isFeeding = false;
  digitalWrite(RELAY_PIN, HIGH); // Active LOW -> ปิด Relay
}

void emergencyStop() {
  stopFeeding();
  Serial.println("[Status] EMERGENCY STOP!");
  if (WiFi.status() == WL_CONNECTED) {
    publishStatus("STOPPED", "Emergency stop executed");
  }
}

// ----------------------------------------------------
// 📡 อ่านและรายงานข้อมูลไปยัง MQTT & Firebase
// ----------------------------------------------------
void readAndReportWeight(bool isWifiConnected) {
  if (scale.is_ready()) {
    float weight = scale.get_units(3);
    if (weight < 0) weight = 0.0;

    RtcDateTime now = myRTC.GetDateTime();
    Serial.printf("[%02d/%02d/%04d %02d:%02d:%02d] [Weight] Food Weight: %.2f g | Free RAM: %d bytes\n", 
              now.Day(), now.Month(), now.Year(),
              now.Hour(), now.Minute(), now.Second(),
              weight, ESP.getFreeHeap());
              
    if (isWifiConnected) {
      if (client.connected()) {
        StaticJsonDocument<128> doc;
        doc["weight_grams"] = weight;
        doc["timestamp"] = millis() / 1000;

        char buffer[128];
        serializeJson(doc, buffer);
        client.publish(pubWeightTopic.c_str(), buffer);
      }

      if (Firebase.ready()) {
        String basePath = "/devices/" + String(DEVICE_ID);
        Firebase.setFloat(fbdo, basePath + "/current_weight", weight);
        Firebase.setInt(fbdo, basePath + "/last_updated", millis() / 1000);
      }
    }
  }
}

// ----------------------------------------------------
// 📩 เช็กคำสั่งจาก Firebase
// ----------------------------------------------------
void checkFirebaseCommands() {
  if (isFeeding) return;

  if (millis() - lastFbCheck >= 1000) {
    lastFbCheck = millis();

    if (Firebase.ready()) {
      String cmdPath = "/devices/" + String(DEVICE_ID) + "/cmd_feed";
      if (Firebase.getInt(fbdo, cmdPath)) {
        int amount = fbdo.intData();
        if (amount > 0) {
          Serial.printf("[Firebase] Trigger Feed: %d g\n", amount);
          
          Firebase.setInt(fbdo, cmdPath, 0); 
          triggerFeeding(amount);
        }
      }
    }
  }
}

void publishStatus(String state, String msg) {
  if (client.connected()) {
    StaticJsonDocument<128> doc;
    doc["state"] = state;
    doc["message"] = msg;
    char buffer[128];
    serializeJson(doc, buffer);
    client.publish(pubStatusTopic.c_str(), buffer);
  }

  if (Firebase.ready()) {
    String basePath = "/devices/" + String(DEVICE_ID);
    if (Firebase.setString(fbdo, basePath + "/status", state)) {
      Serial.println("[Firebase SUCCESS] Status updated!");
    } else {
      Serial.printf("[Firebase ERROR] %s\n", fbdo.errorReason().c_str());
    }
  }
}

// 🟢 สแกนหา Wi-Fi บริเวณใกล้เคียงแล้วส่งกลับเป็น JSON
void handleScanWifi() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  int n = WiFi.scanNetworks();
  StaticJsonDocument<512> doc;
  JsonArray array = doc.to<JsonArray>();

  for (int i = 0; i < n; ++i) {
    array.add(WiFi.SSID(i));
  }

  String json;
  serializeJson(doc, json);
  server.send(200, "application/json", json);
}

// 🟢 บันทึก SSID/Pass แล้วสั่งเชื่อมต่อ Wi-Fi บ้าน
void handleSaveWifi() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  String ssid = server.hasArg("ssid") ? server.arg("ssid") : "";
  String pass = server.hasArg("pass") ? server.arg("pass") : "";

  if (ssid.length() > 0) {
    server.send(200, "application/json", "{\"success\":true,\"message\":\"กำลังบันทึกและเชื่อมต่อ Wi-Fi...\"}");
    delay(1000);
    
    // บันทึกเข้า WiFiManager และสั่งเชื่อมต่อ
    WiFi.begin(ssid.c_str(), pass.c_str());
    ESP.restart();
  } else {
    server.send(400, "application/json", "{\"success\":false,\"message\":\"กรุณาระบุชื่อ SSID\"}");
  }
}

void checkWifiConfigFromFirebase() {
  if (Firebase.ready() && (millis() - lastFbCheck >= 3000)) {
    String path = "/devices/" + String(DEVICE_ID) + "/wifi_config";
    if (Firebase.getString(fbdo, path + "/ssid")) {
      String newSsid = fbdo.stringData();
      if (newSsid.length() > 0) {
        String newPass = "";
        if (Firebase.getString(fbdo, path + "/pass")) {
          newPass = fbdo.stringData();
        }
        // ล้างค่าเดิมบน Firebase
        Firebase.deleteNode(fbdo, path);
        
        // บันทึกเข้า Wi-Fi บ้านแล้วรีบูตบอร์ด
        WiFi.begin(newSsid.c_str(), newPass.c_str());
        ESP.restart();
      }
    }
  }
}