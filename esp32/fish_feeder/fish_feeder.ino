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

// --- 📌 Pin Configurations ---
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
const long reportInterval = 2000; // 🟢 ปรับรายงานค่าน้ำหนักเป็นทุก 2 วินาที (Real-time)
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
void checkWifiConfigFromFirebase();
void handleLocalFeed();
void handleLocalStop();
void setRGB(bool r, bool g, bool b);

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

  digitalWrite(RELAY_PIN, HIGH); // Active LOW -> ปิด Relay ทันที
  setRGB(true, false, false);   // 🔴 เริ่มต้นแสดงสีแดง

  myRTC.Begin();

  scale.begin(HX711_DT, HX711_SCK);
  scale.set_scale(CALIBRATION_FACTOR);
  scale.tare();

  setupWiFi();

  configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");
  if (WiFi.status() == WL_CONNECTED) {
    struct tm timeinfo;
    int retry = 0;
    while (!getLocalTime(&timeinfo) && retry < 10) {
      delay(300);
      retry++;
    }
  }

  server.on("/local-feed", handleLocalFeed);
  server.on("/local-stop", handleLocalStop);
  server.begin();

  espClient.setInsecure();
  client.setServer(MQTT_HOST, MQTT_PORT);
  client.setCallback(callback);
  client.setBufferSize(512);

  setupFirebase();

  setRGB(false, false, true); // 🔵 แสดงสีน้ำเงิน (พร้อมใช้งาน)
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
    checkWifiConfigFromFirebase(); // 🟢 ตรวจการตั้งค่า Wi-Fi ใหม่จาก Firebase
  } else {
    server.handleClient();
  }

  if (isFeeding) {
    setRGB(false, true, false); // 🟢 แสดงสีเขียวขณะให้อาหาร
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
  wm.setDebugOutput(false);
  wm.setConfigPortalBlocking(false);
  wm.autoConnect("FishFeeder-Setup");
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

  digitalWrite(RELAY_PIN, LOW); // เปิด Relay
  feedStartTime = millis();
  isFeeding = true;
}

void stopFeeding() {
  isFeeding = false;
  digitalWrite(RELAY_PIN, HIGH); // ปิด Relay
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

// 📩 เช็กคำสั่งจาก Firebase
void checkFirebaseCommands() {
  if (isFeeding) return;

  if (millis() - lastFbCheck >= 1000) {
    lastFbCheck = millis();

    if (Firebase.ready()) {
      String cmdPath = "/devices/" + String(DEVICE_ID) + "/cmd_feed";
      if (Firebase.getInt(fbdo, cmdPath)) {
        int amount = fbdo.intData();
        if (amount > 0) {
          Firebase.setInt(fbdo, cmdPath, 0); // เคลียร์คำสั่ง
          triggerFeeding(amount);
        } else if (amount == -1) {
          Firebase.setInt(fbdo, cmdPath, 0);
          emergencyStop();
        }
      }
    }
  }
}

// 🟢 เช็กค่าตั้งค่า Wi-Fi บ้านใหม่จาก Firebase
void checkWifiConfigFromFirebase() {
  if (Firebase.ready()) {
    String path = "/devices/" + String(DEVICE_ID) + "/wifi_config";
    if (Firebase.getString(fbdo, path + "/ssid")) {
      String newSsid = fbdo.stringData();
      if (newSsid.length() > 0) {
        String newPass = "";
        if (Firebase.getString(fbdo, path + "/pass")) {
          newPass = fbdo.stringData();
        }
        
        Firebase.deleteNode(fbdo, path); // ล้างค่าหลังอ่านเสร็จ
        
        WiFi.begin(newSsid.c_str(), newPass.c_str());
        ESP.restart();
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