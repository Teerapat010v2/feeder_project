const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/fish_feeder.ino', 'utf8');
c = c.replace('} else if (strcmp(action, "SET_MODE") == 0) {', '} else if (strcmp(action, "SET_SPEED") == 0) {\n      currentMotorSpeed = doc["speed"] | 100;\n      if(currentMotorSpeed < 0) currentMotorSpeed = 0;\n      if(currentMotorSpeed > 100) currentMotorSpeed = 100;\n      preferences.begin("motor_config", false);\n      preferences.putInt("speed", currentMotorSpeed);\n      preferences.end();\n      publishMQTTStatus();\n    } else if (strcmp(action, "SET_MODE") == 0) {');
fs.writeFileSync('esp32/fish_feeder/fish_feeder.ino', c);
console.log('Fixed MQTT SET_SPEED');
