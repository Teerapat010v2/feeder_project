const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/fish_feeder.ino', 'utf8');

c = c.replace(/doc\["mode"\]\s*=\s*currentMode;/g, 'doc["mode"] = currentMode;\n  doc["motor_speed"] = currentMotorSpeed;');

fs.writeFileSync('esp32/fish_feeder/fish_feeder.ino', c);
console.log('Fixed handleApiStatus motor_speed');
