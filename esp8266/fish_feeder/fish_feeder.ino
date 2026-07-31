#include <ESP8266WiFi.h>
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

  // ระบบเชื่อมต่อ Wi-Fi และ Redirect ไป Vercel Dashboard
  setupWiFi();

  espClient.setInsecure();
  espClient.setBufferSizes(512, 512);
  client.setServer(MQTT_HOST, MQTT_PORT);
  client.setCallback(callback);
  client.setBufferSize(512); // 🟢 ขยาย Buffer ของ PubSubClient ให้รองรับ JSON
}

void loop() {
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
// 📶 เชื่อมต่อ Wi-Fi และ Redirect ไป Vercel Dashboard
// ----------------------------------------------------
void setupWiFi() {
  WiFiManager wm;
  String dashboardUrl = "https://feederproject.vercel.app/"; 

  // เมื่อผู้ใช้กด Save Wi-Fi สำเร็จ ให้เด้งไปหน้า Vercel Dashboard ทันที
  String customHead = "<script>"
                      "if (window.location.pathname === '/wifisave') {"
                      "  setTimeout(function(){ window.location.href = '" + dashboardUrl + "'; }, 2000);"
                      "}"
                      "</script>";
  wm.setCustomHeadElement(customHead.c_str());

  // 🚨 ปลดคอมเมนต์บรรทัดล่าง หากต้องการล้างค่า Wi-Fi เก่าออกเพื่อทดสอบ
  // wm.resetSettings();

  bool res = wm.autoConnect("FishFeeder-Setup");

  if (!res) {
    Serial.println("Failed to connect or hit timeout");
    ESP.restart();
  } else {
    Serial.println("\nWiFi connected successfully!");
    digitalWrite(LED_PIN, LOW); // ไฟติดเมื่อต่อ Wi-Fi บ้านสำเร็จ
  }
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
// 📩 รับคำสั่ง (Callback)
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

  digitalWrite(RELAY_PIN, HIGH); // 🟢 ลองเปลี่ยนจาก LOW เป็น HIGH
  digitalWrite(LED_PIN, LOW);
}

void stopFeeding() {
  isFeeding = false;
  digitalWrite(RELAY_PIN, LOW);  // 🟢 ลองเปลี่ยนจาก HIGH เป็น LOW
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