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
WiFiManager wm; // ย้ายออกมาเป็น Global เพื่อใช้ร่วมกับ Callback

// --- MQTT Topics ---
String subFeedTopic   = "fishfeeder/" + String(DEVICE_ID) + "/cmd/feed";
String subStopTopic   = "fishfeeder/" + String(DEVICE_ID) + "/cmd/stop";
String pubStatusTopic = "fishfeeder/" + String(DEVICE_ID) + "/status";
String pubWeightTopic = "fishfeeder/" + String(DEVICE_ID) + "/weight";

// Timers & State Variables
unsigned long lastWeightReport = 0;
const long reportInterval = 5000;

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
void publishWeight();
void handleLocalFeed();
void handleLocalStop();
void bindServerCallback();

void setup() {
  Serial.begin(115200);

  // Pin Modes setup (สำหรับ Active LOW Relay)
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, HIGH); // HIGH = ปิด Relay
  digitalWrite(LED_PIN, HIGH);   // HIGH = ดับ LED

  Wire.begin(SDA_PIN, SCL_PIN);

  scale.begin(HX711_DT, HX711_SCK);
  scale.set_scale(CALIBRATION_FACTOR);
  scale.tare();

  // ระบบเชื่อมต่อ Wi-Fi และแสดงปุ่มสั่งงานหน้า AP
  setupWiFi();

  // 🟢 ตั้งค่า HTTP Web Server สำหรับ Local Mode (หลังต่อ Wi-Fi บ้านสำเร็จ)
  server.on("/local-feed", handleLocalFeed);
  server.on("/local-stop", handleLocalStop);
  server.begin();
  Serial.println("HTTP Server started for Local Mode!");

  espClient.setInsecure();
  espClient.setBufferSizes(512, 512);
  client.setServer(MQTT_HOST, MQTT_PORT);
  client.setCallback(callback);
  client.setBufferSize(512);
}

void loop() {
  // ประมวลผลคำสั่ง HTTP (Local Mode เมื่อต่อ Wi-Fi แล้ว)
  server.handleClient();

  if (!client.connected()) {
    reconnectMQTT();
  }
  client.loop();

  unsigned long currentMillis = millis();

  // ตรวจสอบเวลาให้อาหาร (Non-blocking)
  if (isFeeding) {
    if (currentMillis - feedStartTime >= feedDuration) {
      stopFeeding();
      publishStatus("IDLE", "Feeding complete");
      publishWeight();
    }
  }

  // ส่งค่าน้ำหนักทุกช่วงเวลา
  if (currentMillis - lastWeightReport >= reportInterval) {
    lastWeightReport = currentMillis;
    publishWeight();
  }
}

// ----------------------------------------------------
// 📶 เชื่อมต่อ Wi-Fi + ช่องกรอกปริมาณอาหารหน้า Setup AP
// ----------------------------------------------------
void setupWiFi() {
  String dashboardUrl = "https://feederproject.vercel.app/"; 

  // 🟢 เพิ่มช่องกรอกตัวเลข (Input Box) พร้อมปุ่มส่งค่ากรัม
  WiFiManagerParameter custom_feed_form(
    "<br/>"
    "<form action='/local-feed' method='GET' style='margin-bottom:12px;text-align:left;'>"
      "<label style='font-weight:bold;font-size:14px;'>🐟 ระบุปริมาณอาหาร (กรัม):</label><br/>"
      "<input type='number' name='amount' value='10' min='1' max='500' "
             "style='width:100%;padding:10px;margin:6px 0 12px 0;box-sizing:border-box;border:1px solid #ccc;border-radius:6px;font-size:16px;'><br/>"
      "<button type='submit' style='width:100%;background-color:#28a745;color:white;padding:12px;border:none;border-radius:6px;font-size:16px;font-weight:bold;cursor:pointer;'>"
        "🚀 สั่งให้อาหาร (Local AP)"
      "</button>"
    "</form>"
  );
  
  WiFiManagerParameter custom_stop_btn(
    "<a href='/local-stop'>"
    "<button type='button' style='width:100%;background-color:#dc3545;color:white;padding:12px;border:none;border-radius:6px;font-size:16px;font-weight:bold;cursor:pointer;'>"
      "🛑 หยุดฉุกเฉิน (Emergency Stop)"
    "</button></a><br/><hr/>"
  );

  wm.addParameter(&custom_feed_form);
  wm.addParameter(&custom_stop_btn);

  // ผูก Route /local-feed และ /local-stop เข้ากับ WebServer ของ WiFiManager
  wm.setWebServerCallback(bindServerCallback);

  // เมื่อผู้ใช้กด Save Wi-Fi สำเร็จ ให้เด้งไปหน้า Vercel Dashboard
  String customHead = "<script>"
                      "if (window.location.pathname === '/wifisave') {"
                      "  setTimeout(function(){ window.location.href = '" + dashboardUrl + "'; }, 2000);"
                      "}"
                      "</script>";
  wm.setCustomHeadElement(customHead.c_str());

  // ล้างค่า Wi-Fi เก่าออกทุกครั้งที่เปิดเครื่อง/เสียบสายใหม่
  wm.resetSettings();

  bool res = wm.autoConnect("FishFeeder-Setup");

  if (!res) {
    Serial.println("Failed to connect or hit timeout");
    ESP.restart();
  } else {
    Serial.println("\nWiFi connected successfully!");
    Serial.print("Local IP Address: ");
    Serial.println(WiFi.localIP());
    digitalWrite(LED_PIN, LOW);
  }
}

// ----------------------------------------------------
// 🌐 Route สำหรับสั่งงานช่วงค้างหน้า WiFiManager (AP Mode)
// ----------------------------------------------------
void bindServerCallback() {
  wm.server->on("/local-feed", []() {
    int amount = 10;
    if (wm.server->hasArg("amount")) {
      amount = wm.server->arg("amount").toInt();
    }
    if (amount <= 0) amount = 10;
    
    triggerFeeding(amount);
    
    String html = "<html><head><meta name='viewport' content='width=device-width, initial-scale=1'></head>"
                  "<body style='text-align:center;font-family:sans-serif;padding-top:50px;'>"
                  "<h2 style='color:#28a745;'>✅ สั่งให้อาหาร " + String(amount) + " กรัม สำเร็จ!</h2>"
                  "<br/><a href='/'><button style='padding:10px 20px;font-size:16px;'>กลับหน้าหลัก</button></a>"
                  "</body></html>";
    wm.server->send(200, "text/html", html);
  });

  wm.server->on("/local-stop", []() {
    emergencyStop();
    
    String html = "<html><head><meta name='viewport' content='width=device-width, initial-scale=1'></head>"
                  "<body style='text-align:center;font-family:sans-serif;padding-top:50px;'>"
                  "<h2 style='color:#dc3545;'>🛑 สั่งหยุดฉุกเฉินเรียบร้อย!</h2>"
                  "<br/><a href='/'><button style='padding:10px 20px;font-size:16px;'>กลับหน้าหลัก</button></a>"
                  "</body></html>";
    wm.server->send(200, "text/html", html);
  });
}

// ----------------------------------------------------
// 🌐 Route Handlers สำหรับ Local Mode (หลังต่อ Wi-Fi บ้านแล้ว)
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
// 🔄 การเชื่อมต่อ MQTT Broker
// ----------------------------------------------------
void reconnectMQTT() {
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    String clientId = "ESP8266Client-" + String(DEVICE_ID) + "-" + String(random(0xffff), HEX);

    if (client.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
      Serial.println("CONNECTED!");
      client.subscribe(subFeedTopic.c_str());
      client.subscribe(subStopTopic.c_str());
      publishStatus("ONLINE", "Device connected & scale ready");
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      delay(5000);
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
  Serial.printf("Feeding action started! Target: %d grams\n", amountGrams);
  publishStatus("FEEDING", "Relay ON - Dispensing food...");

  int duration = (amountGrams / 10) * 2000;
  if (duration < 1000) duration = 1000;

  feedDuration = duration;
  feedStartTime = millis();
  isFeeding = true;

  digitalWrite(RELAY_PIN, LOW); // Active LOW -> สั่ง LOW เพื่อเปิด
  digitalWrite(LED_PIN, LOW);
}

void stopFeeding() {
  isFeeding = false;
  digitalWrite(RELAY_PIN, HIGH); // Active LOW -> สั่ง HIGH เพื่อปิด
  digitalWrite(LED_PIN, HIGH);
}

void emergencyStop() {
  stopFeeding();
  Serial.println("EMERGENCY STOP TRIGGERED!");
  publishStatus("STOPPED", "Emergency stop executed");
}

void publishWeight() {
  if (scale.is_ready()) {
    float weight = scale.get_units(5);
    if (weight < 0) weight = 0.0;

    StaticJsonDocument<128> doc;
    doc["weight_grams"] = weight;
    doc["timestamp"] = millis() / 1000;

    char buffer[128];
    serializeJson(doc, buffer);

    client.publish(pubWeightTopic.c_str(), buffer);
    Serial.printf("Current Food Weight: %.2f g\n", weight);
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