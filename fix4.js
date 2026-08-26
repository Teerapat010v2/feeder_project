const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/fish_feeder.ino', 'utf8');
c = c.replace('doc["online"] = true;', 'doc["online"] = true;\n    doc["motor_speed"] = currentMotorSpeed;');
fs.writeFileSync('esp32/fish_feeder/fish_feeder.ino', c);
console.log('Fixed MQTT JSON');
