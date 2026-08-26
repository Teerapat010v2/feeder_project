const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/fish_feeder.ino', 'utf8');

let publishHist = `
      // ส่งประวัติล่าสุดเข้า MQTT ตอนเชื่อมต่อด้วย เผื่อไฟตก
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
`;

c = c.replace('publishMQTTStatus();\n    }', 'publishMQTTStatus();\n' + publishHist + '\n    }');

fs.writeFileSync('esp32/fish_feeder/fish_feeder.ino', c);
console.log('Added MQTT history publish on connect');
