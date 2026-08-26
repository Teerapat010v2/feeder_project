const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/data/app.js', 'utf8');

c = c.replace('mqttClient.publish(DEVICE_ID + "/command", JSON.stringify(payload));', 'mqttClient.publish(TOPIC_CMD, JSON.stringify(payload));');

fs.writeFileSync('esp32/fish_feeder/data/app.js', c);
console.log('Fixed SET_SPEED topic in app.js');
