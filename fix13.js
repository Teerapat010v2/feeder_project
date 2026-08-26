const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/fish_feeder.ino', 'utf8');

if(!c.includes('<HTTPClient.h>')) {
    c = c.replace('#include <PubSubClient.h>', '#include <PubSubClient.h>\n#include <HTTPClient.h>\n#include <WiFiClientSecure.h>');
}

let syncFunction = `
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
          Serial.printf("✅ ส่งประวัติขึ้น Vercel สำเร็จ: %d\\n", httpCode);
        } else {
          Serial.printf("❌ ส่งประวัติขึ้น Vercel ล้มเหลว: %s\\n", https.errorToString(httpCode).c_str());
        }
        https.end();
      }
      delete client;
    }
  }
}
`;

if(!c.includes('sendHistoryToVercel')) {
    c = c.replace('void stopFeeding() {', syncFunction + '\nvoid stopFeeding() {');
}

c = c.replace('saveHistoryToSPIFFS();\n  Serial.println("✅ บันทึกประวัติลง Memory แล้ว");', 'saveHistoryToSPIFFS();\n  Serial.println("✅ บันทึกประวัติลง Memory แล้ว");\n  sendHistoryToVercel((int)dispensed, currentFeedMode);');

fs.writeFileSync('esp32/fish_feeder/fish_feeder.ino', c);
console.log('Added Vercel sync to ESP32');
