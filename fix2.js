const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/fish_feeder.ino', 'utf8');
c = c.replace('void handleGetHistory();', 'void handleGetHistory();\nvoid handleSetSpeed();');
c = c.replace('server.on("/api/set-mode", HTTP_GET, handleSetMode);', 'server.on("/api/set-mode", HTTP_GET, handleSetMode);\n  server.on("/api/set-speed", HTTP_GET, handleSetSpeed);');
c = c.replace('// 📌 API เปลี่ยนโหมดการทำงาน', 'void handleSetSpeed() {\n  if (server.hasArg("speed")) {\n    currentMotorSpeed = server.arg("speed").toInt();\n    if(currentMotorSpeed < 0) currentMotorSpeed = 0;\n    if(currentMotorSpeed > 100) currentMotorSpeed = 100;\n    preferences.begin("motor_config", false);\n    preferences.putInt("speed", currentMotorSpeed);\n    preferences.end();\n    server.send(200, "application/json", "{\\"success\\":true,\\"message\\":\\"ตั้งค่าความเร็วมอเตอร์สำเร็จ\\"}");\n  } else {\n    server.send(400, "application/json", "{\\"success\\":false,\\"message\\":\\"Missing speed argument\\"}");\n  }\n}\n\n// 📌 API เปลี่ยนโหมดการทำงาน');
fs.writeFileSync('esp32/fish_feeder/fish_feeder.ino', c);
console.log('Fixed API');
