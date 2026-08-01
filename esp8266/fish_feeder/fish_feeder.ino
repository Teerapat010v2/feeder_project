#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <WiFiManager.h>
#include "HX711.h"
#include "secrets.h"

// --- 📌 Pin Configurations ---
#define HX711_DT  D5
#define HX711_SCK D6
#define RELAY_PIN D1
#define LED_PIN   D4
#define SDA_PIN   D2
#define SCL_PIN   D3

// --- ⚙️ Calibration Values ---
#define CALIBRATION_FACTOR 220.4

// --- Objects ---
HX711 scale;
WiFiClientSecure espClient;
PubSubClient client(espClient);
ESP8266WebServer server(80);
WiFiManager wm;

// --- MQTT Topics ---
String subFeedTopic   = "fishfeeder/" + String(DEVICE_ID) + "/cmd/feed";
String subStopTopic   = "fishfeeder/" + String(DEVICE_ID) + "/cmd/stop";
String pubStatusTopic = "fishfeeder/" + String(DEVICE_ID) + "/status";
String pubWeightTopic = "fishfeeder/" + String(DEVICE_ID) + "/weight";

// Timers & State Variables
unsigned long lastWeightReport = 0;
const long reportInterval = 5000; // 5 วินาที

bool isFeeding = false;
unsigned long feedStartTime = 0;
unsigned long feedDuration = 0;

// Function Declarations
void setupWiFi();
void reconnectMQTT();
void callback(char* topic, byte* payload, unsigned int length);
void triggerFeeding(int amountGrams);
void stopFeeding();
void emergencyStop();
void publishStatus(String state, String msg);
void readAndReportWeight(bool isWifiConnected);
void handleLocalFeed();
void handleLocalStop();
void bindServerCallback();
void sendCustomUI(ESP8266WebServer *srv);

// ----------------------------------------------------
// 🎨 หน้า Web UI แบบ Custom
// ----------------------------------------------------
const char PAGE_LOCAL_UI[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ควบคุมแบบ Local (Direct)</title>
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
    <div class="title">🐟 ควบคุมแบบ Local (Direct)</div>
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

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n--- [System Initialization] ---");

  pinMode(RELAY_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, HIGH); // Active LOW -> ปิด Relay
  digitalWrite(LED_PIN, HIGH);

  Wire.begin(SDA_PIN, SCL_PIN);

  scale.begin(HX711_DT, HX711_SCK);
  scale.set_scale(CALIBRATION_FACTOR);
  scale.tare();

  // ตั้งค่า WiFiManager
  setupWiFi();

  // ตั้งค่า Web Server หน้า Local
  server.on("/", []() { sendCustomUI(&server); });
  server.on("/local", []() { sendCustomUI(&server); });
  server.on("/local-feed", handleLocalFeed);
  server.on("/local-stop", handleLocalStop);
  server.begin();

  espClient.setInsecure();
  espClient.setBufferSizes(512, 512);
  client.setServer(MQTT_HOST, MQTT_PORT);
  client.setCallback(callback);
  client.setBufferSize(512);

  Serial.println("--- [System Ready] ---");
}

void loop() {
  wm.process(); // คอยรัน WiFiManager AP

  unsigned long currentMillis = millis();
  bool isWifiConnected = (WiFi.status() == WL_CONNECTED);

  // 1. 📡 ตรวจจับสถานะการเชื่อมต่อ (แจ้งเตือนเมื่อเปลี่ยนสถานะเท่านั้น)
  static bool lastWifiConnected = false;
  if (isWifiConnected != lastWifiConnected) {
    lastWifiConnected = isWifiConnected;
    if (isWifiConnected) {
      Serial.print("\n[WiFi] Connected! Local IP: ");
      Serial.println(WiFi.localIP());
      digitalWrite(LED_PIN, LOW);
    } else {
      Serial.println("\n[WiFi] Disconnected! Running in AP Mode ('FishFeeder-Setup')");
      digitalWrite(LED_PIN, HIGH);
    }
  }

  // 2. 🌐 จัดการ Web Server และ MQTT เมื่อเชื่อม Wi-Fi บ้านได้
  if (isWifiConnected) {
    server.handleClient();

    if (!client.connected()) {
      reconnectMQTT();
    } else {
      client.loop();
    }
  }

  // 3. ⚙️ ระบบนับเวลาปิดมอเตอร์สั่งให้อาหาร
  if (isFeeding) {
    if (currentMillis - feedStartTime >= feedDuration) {
      stopFeeding();
      Serial.println("[Status] Feeding Complete -> Motor STOP");
      if (isWifiConnected) {
        publishStatus("IDLE", "Feeding complete");
      }
    }
  }

  // 4. ⚖️ พิมพ์ค่าน้ำหนักทุกๆ 5 วินาที (ทำงานตลอดเวลา)
  if (currentMillis - lastWeightReport >= reportInterval) {
    lastWeightReport = currentMillis;
    readAndReportWeight(isWifiConnected);
  }

  yield(); // ป้องกัน ESP8266 WDT Reset
}

// ----------------------------------------------------
// 📶 ตั้งค่า WiFiManager
// ----------------------------------------------------
void setupWiFi() {
  String dashboardUrl = "https://feederproject.vercel.app/"; 

  wm.setDebugOutput(false);            // ปิด Log RED! ใน Serial
  wm.setConfigPortalBlocking(false);  // ปล่อยให้ loop() ทำงานได้
  wm.setWebServerCallback(bindServerCallback);

  String customHead = "<script>"
                      "if (window.location.pathname === '/wifisave') {"
                      "  setTimeout(function(){ window.location.href = '" + dashboardUrl + "'; }, 2000);"
                      "}"
                      "</script>";
  wm.setCustomHeadElement(customHead.c_str());

  wm.resetSettings(); // ล้างค่า Wi-Fi เดิมเมื่อเปิดเครื่องใหม่

  if (wm.startConfigPortal("FishFeeder-Setup")) {
    Serial.println("[WiFi] Connected to saved network directly!");
  } else {
    Serial.println("[WiFi] AP Mode Active -> SSID: 'FishFeeder-Setup' (192.168.4.1)");
  }
}

void sendCustomUI(ESP8266WebServer *srv) {
  srv->send(200, "text/html", PAGE_LOCAL_UI);
}

// ----------------------------------------------------
// 🌐 Bind Routes ใน WiFiManager AP Server
// ----------------------------------------------------
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

// ----------------------------------------------------
// 🌐 Route Handlers สำหรับ Local Mode
// ----------------------------------------------------
void handleLocalFeed() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  
  int amount = 10;
  if (server.hasArg("amount")) {
    amount = server.arg("amount").toInt();
  }
  if (amount <= 0) amount = 10;
  
  triggerFeeding(amount);
  
  String jsonResponse = "{\"success\":true,\"message\":\"Local feeding started\",\"amount\":" + String(amount) + "}";
  server.send(200, "application/json", jsonResponse);
}

void handleLocalStop() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  emergencyStop();
  
  String jsonResponse = "{\"success\":true,\"message\":\"Local emergency stop executed\"}";
  server.send(200, "application/json", jsonResponse);
}

// ----------------------------------------------------
// 🔄 การเชื่อมต่อ MQTT Broker (Non-blocking)
// ----------------------------------------------------
void reconnectMQTT() {
  static unsigned long lastReconnectAttempt = 0;
  unsigned long now = millis();

  if (!client.connected() && (now - lastReconnectAttempt > 5000)) {
    lastReconnectAttempt = now;
    Serial.print("[MQTT] Connecting to Broker...");
    String clientId = "ESP8266Client-" + String(DEVICE_ID) + "-" + String(random(0xffff), HEX);

    if (client.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
      Serial.println(" SUCCESS!");
      client.subscribe(subFeedTopic.c_str());
      client.subscribe(subStopTopic.c_str());
      publishStatus("ONLINE", "Device connected & scale ready");
    } else {
      Serial.printf(" FAILED (rc=%d)\n", client.state());
    }
  }
}

// ----------------------------------------------------
// 📩 รับคำสั่ง (MQTT Callback)
// ----------------------------------------------------
void callback(char* topic, byte* payload, unsigned int length) {
  String incomingTopic = String(topic);
  StaticJsonDocument<256> doc;
  DeserializationError error = deserializeJson(doc, payload, length);

  if (error) return;

  if (incomingTopic == subFeedTopic) {
    int amount = doc["amount"] | 10;
    triggerFeeding(amount);
  } else if (incomingTopic == subStopTopic) {
    emergencyStop();
  }
}

// ----------------------------------------------------
// ⚙️ กลไกการสั่งให้อาหาร & หยุด
// ----------------------------------------------------
void triggerFeeding(int amountGrams) {
  Serial.printf("[Action] Dispensing %d grams of food...\n", amountGrams);

  int duration = (amountGrams / 10) * 2000;
  if (duration < 1000) duration = 1000;

  feedDuration = duration;
  feedStartTime = millis();
  isFeeding = true;

  digitalWrite(RELAY_PIN, LOW); // Active LOW -> เปิด Relay
  digitalWrite(LED_PIN, LOW);

  if (WiFi.status() == WL_CONNECTED) {
    publishStatus("FEEDING", "Relay ON - Dispensing food...");
  }
}

void stopFeeding() {
  isFeeding = false;
  digitalWrite(RELAY_PIN, HIGH); // Active LOW -> ปิด Relay
  digitalWrite(LED_PIN, HIGH);
}

void emergencyStop() {
  stopFeeding();
  Serial.println("[Status] EMERGENCY STOP EXECUTED!");
  if (WiFi.status() == WL_CONNECTED) {
    publishStatus("STOPPED", "Emergency stop executed");
  }
}

// ----------------------------------------------------
// ⚖️ อ่านและรายงานค่าน้ำหนัก (ทุกๆ 5 วินาที)
// ----------------------------------------------------
void readAndReportWeight(bool isWifiConnected) {
  if (scale.is_ready()) {
    float weight = scale.get_units(3); // อ่านค่า 3 รอบเพื่อความรวดเร็ว
    if (weight < 0) weight = 0.0;

    // 🟢 พิมพ์ออก Serial Monitor เสมอ
    Serial.printf("[Weight] Current Food Weight: %.2f g\n", weight);

    // 🟢 ส่งขึ้น MQTT เมื่อเชื่อมต่อเน็ตอยู่
    if (isWifiConnected && client.connected()) {
      StaticJsonDocument<128> doc;
      doc["weight_grams"] = weight;
      doc["timestamp"] = millis() / 1000;

      char buffer[128];
      serializeJson(doc, buffer);
      client.publish(pubWeightTopic.c_str(), buffer);
    }
  } else {
    Serial.println("[Weight] Loadcell / HX711 Not Ready!");
  }
}

void publishStatus(String state, String msg) {
  StaticJsonDocument<128> doc;
  doc["state"] = state;
  doc["message"] = msg;

  char buffer[128];
  serializeJson(doc, buffer);

  client.publish(pubStatusTopic.c_str(), buffer);
}