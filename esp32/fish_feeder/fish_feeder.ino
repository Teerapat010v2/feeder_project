#include <WiFi.h>
#include <WebServer.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <FirebaseESP32.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <WiFiManager.h>
#include "HX711.h"
#include <RtcDS1302.h>
#include <ThreeWire.h>
#include "secrets.h"

// --- 📌 Pin Configurations (ESP32) ---
#define HX711_DT   16
#define HX711_SCK  17
#define RELAY_PIN  18

// 🔴🟢🔵 RGB LED Pins (Common Cathode)
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
ThreeWire myWire(RTC_DAT, RTC_CLK, RTC_RST);
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
const long reportInterval = 5000;
unsigned long lastFbCheck = 0;

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
void handleScanWifi();
void handleSaveWifi();
void handleResetWifi();
void bindServerCallback();
void sendCustomUI(WebServer *srv);
void setRGB(bool r, bool g, bool b);

// 🎨 หน้า Web UI แบบ Custom (Local Page)
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
    .btn { display: block; width: 100%; padding: 14px; border: none; border-radius: 10px; font-size: 16px; font-weight: bold; cursor: pointer; text-decoration: none; text-align: center; margin-bottom: 12px; }
    .btn-blue { background-color: #007bff; color: white; }
    .btn-red { background-color: #dc3545; color: white; }
    .btn-grey { background-color: #6c757d; color: white; }
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

void setRGB(bool r, bool g, bool b) {
  digitalWrite(LED_R, r ? HIGH : LOW);
  digitalWrite(LED_G, g ? HIGH : LOW);
  digitalWrite(LED_B, b ? HIGH : LOW);
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n--- [ESP32 System Initialization] ---");

  pinMode(RELAY_PIN, OUTPUT);
  pinMode(LED_R, OUTPUT);
  pinMode(LED_G, OUTPUT);
  pinMode(LED_B, OUTPUT);

  digitalWrite(RELAY_PIN, HIGH);
  setRGB(true, false, false);

  myRTC.Begin();

  scale.begin(HX711_DT, HX711_SCK);
  scale.set_scale(CALIBRATION_FACTOR);
  scale.tare();

  // 1. ตั้งค่า Wi-Fi
  setupWiFi();

  // 2. NTP Sync
  configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");
  if (WiFi.status() == WL_CONNECTED) {
    struct tm timeinfo;
    int retry = 0;
    while (!getLocalTime(&timeinfo) && retry < 10) {
      delay(300);
      retry++;
    }
  }

  // 3. Local Web Server Endpoints (เชื่อมต่อกับ settings.html & app.js)
  server.on("/", []() { sendCustomUI(&server); });
  server.on("/local", []() { sendCustomUI(&server); });
  server.on("/local-feed", handleLocalFeed);
  server.on("/local-stop", handleLocalStop);
  
  // 🟢 API เพิ่มเติมเพื่อให้ settings.html ใช้งานได้จริง
  server.on("/api/scan-wifi", handleScanWifi);
  server.on("/api/save-wifi", handleSaveWifi);
  server.on("/api/reset-wifi", handleResetWifi);
  
  server.begin();

  // 4. MQTT Client
  espClient.setInsecure();
  client.setServer(MQTT_HOST, MQTT_PORT);
  client.setCallback(callback);
  client.setBufferSize(512);

  // 5. Firebase
  setupFirebase();

  setRGB(false, false, true);
  Serial.println("--- [System Ready] ---");
}

void loop() {
  wm.process();

  unsigned long currentMillis = millis();
  bool isWifiConnected = (WiFi.status() == WL_CONNECTED);

  static bool lastWifiConnected = false;
  if (isWifiConnected != lastWifiConnected) {
    lastWifiConnected = isWifiConnected;
    if (isWifiConnected) {
      setRGB(false, false, true);
    } else {
      setRGB(true, false, false);
    }
  }

  if (isWifiConnected) {
    server.handleClient();

    if (!client.connected()) {
      reconnectMQTT();
    } else {
      client.loop();
    }

    checkFirebaseCommands();
  } else {
    // ให้ Web Server ทำงานได้ด้วยแม้อยู่ในโหมด AP
    server.handleClient();
  }

  if (isFeeding) {
    setRGB(false, true, false);
    if (currentMillis - feedStartTime >= feedDuration) {
      stopFeeding();
      setRGB(false, false, true);
      if (isWifiConnected) {
        publishStatus("IDLE", "Feeding complete");
      }
    }
  }

  if (currentMillis - lastWeightReport >= reportInterval) {
    lastWeightReport = currentMillis;
    readAndReportWeight(isWifiConnected);
  }

  yield();
}

void setupFirebase() {
  config.host = FIREBASE_HOST;
  config.signer.tokens.legacy_token = FIREBASE_AUTH;

  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);
  fbdo.setResponseSize(1024);
}

void setupWiFi() {
  String dashboardUrl = "https://feederproject.vercel.app/"; 

  // 🔴 เอา wm.resetSettings() ออก เพื่อให้บอร์ดจำค่า Wi-Fi บ้านที่ตั้งไว้จาก settings.html
  wm.setDebugOutput(false);
  wm.setConfigPortalBlocking(false);
  wm.setWebServerCallback(bindServerCallback);

  String customHead = "<script>"
                      "window.addEventListener('DOMContentLoaded', function() {"
                      "  if (window.location.pathname.indexOf('/wifisave') !== -1) {"
                      "    document.body.innerHTML = '<div style=\"text-align:center;padding:50px;font-family:sans-serif;\">"
                      "<h2>✅ บันทึก Wi-Fi เรียบร้อย!</h2>"
                      "<p>กำลังนำคุณไปยังหน้าควบคุม Vercel ใน <b>3 วินาที</b>...</p></div>';"
                      "    setTimeout(function(){ window.location.href = '" + dashboardUrl + "'; }, 3000);"
                      "  }"
                      "});"
                      "</script>";
  wm.setCustomHeadElement(customHead.c_str());

  wm.autoConnect("FishFeeder-Setup");
}

void sendCustomUI(WebServer *srv) {
  srv->send(200, "text/html", PAGE_LOCAL_UI);
}

void bindServerCallback() {
  wm.server->on("/", []() { sendCustomUI(wm.server.get()); });
  wm.server->on("/local", []() { sendCustomUI(wm.server.get()); });

  wm.server->on("/local-feed", []() {
    int amount = wm.server->hasArg("amount") ? wm.server->arg("amount").toInt() : 10;
    if (amount <= 0) amount = 10;
    triggerFeeding(amount);
    
    String html = "<html><body style='text-align:center;font-family:sans-serif;padding-top:50px;'>"
                  "<h2>✅ สั่งให้อาหาร " + String(amount) + " กรัม สำเร็จ!</h2>"
                  "<a href='/local'>กลับหน้าหลัก</a></body></html>";
    wm.server->send(200, "text/html", html);
  });

  wm.server->on("/local-stop", []() {
    emergencyStop();
    String html = "<html><body style='text-align:center;font-family:sans-serif;padding-top:50px;'>"
                  "<h2>🛑 สั่งหยุดฉุกเฉินเรียบร้อย!</h2>"
                  "<a href='/local'>กลับหน้าหลัก</a></body></html>";
    wm.server->send(200, "text/html", html);
  });
}

void handleLocalFeed() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  int amount = server.hasArg("amount") ? server.arg("amount").toInt() : 10;
  if (amount <= 0) amount = 10;
  
  triggerFeeding(amount);
  server.send(200, "application/json", "{\"success\":true,\"message\":\"Local feed executed\"}");
}

void handleLocalStop() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  emergencyStop();
  server.send(200, "application/json", "{\"success\":true,\"message\":\"Local stop executed\"}");
}

// 🟢 สแกนหา Wi-Fi รอบข้างส่งกลับให้ settings.html
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

// 🟢 บันทึก Wi-Fi บ้านใหม่จาก settings.html
void handleSaveWifi() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  String ssid = server.arg("ssid");
  String pass = server.arg("pass");

  if (ssid.length() > 0) {
    server.send(200, "application/json", "{\"success\":true,\"message\":\"กำลังบันทึกและรีบูต...\"}");
    delay(1000);
    WiFi.begin(ssid.c_str(), pass.c_str());
    ESP.restart();
  } else {
    server.send(400, "application/json", "{\"success\":false,\"message\":\"กรุณาระบุ SSID\"}");
  }
}

// 🟢 ปุ่มลืมเครือข่าย / รีเซ็ตค่า Wi-Fi จาก settings.html
void handleResetWifi() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  wm.resetSettings();
  server.send(200, "application/json", "{\"success\":true,\"message\":\"รีเซ็ต Wi-Fi เรียบร้อย กำลังรีบูต...\"}");
  delay(1000);
  ESP.restart();
}

void reconnectMQTT() {
  static unsigned long lastReconnectAttempt = 0;
  unsigned long now = millis();

  if (!client.connected() && (now - lastReconnectAttempt > 5000)) {
    lastReconnectAttempt = now;
    String clientId = "ESP32Client-" + String(DEVICE_ID) + "-" + String(random(0xffff), HEX);

    if (client.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
      client.subscribe(subFeedTopic.c_str());
      client.subscribe(subStopTopic.c_str());
      publishStatus("ONLINE", "Connected & Ready");
    }
  }
}

void callback(char* topic, byte* payload, unsigned int length) {
  String incomingTopic = String(topic);
  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, payload, length)) return;

  if (incomingTopic == subFeedTopic) {
    int amount = doc["amount"] | doc["amountGrams"] | 10;
    triggerFeeding(amount);
  } else if (incomingTopic == subStopTopic) {
    emergencyStop();
  }
}

void triggerFeeding(int amountGrams) {
  if (isFeeding) return;

  unsigned long duration = (unsigned long)((amountGrams / 10.0) * 2000.0);
  if (duration < 1000) duration = 1000;
  feedDuration = duration;

  if (WiFi.status() == WL_CONNECTED) {
    publishStatus("FEEDING", "Dispensing food...");
  }

  digitalWrite(RELAY_PIN, LOW);
  feedStartTime = millis();
  isFeeding = true;
}

void stopFeeding() {
  isFeeding = false;
  digitalWrite(RELAY_PIN, HIGH);
}

void emergencyStop() {
  stopFeeding();
  if (WiFi.status() == WL_CONNECTED) {
    publishStatus("STOPPED", "Emergency stop executed");
  }
}

void readAndReportWeight(bool isWifiConnected) {
  if (scale.is_ready()) {
    float weight = scale.get_units(3);
    if (weight < 0) weight = 0.0;

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

void checkFirebaseCommands() {
  if (isFeeding) return;

  if (millis() - lastFbCheck >= 1000) {
    lastFbCheck = millis();

    if (Firebase.ready()) {
      String cmdPath = "/devices/" + String(DEVICE_ID) + "/cmd_feed";
      if (Firebase.getInt(fbdo, cmdPath)) {
        int amount = fbdo.intData();
        if (amount > 0) {
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
    Firebase.setString(fbdo, basePath + "/status", state);
  }
}