const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/fish_feeder.ino', 'utf8');

c = c.replace(/digitalWrite\(RELAY_PIN, RELAY_OFF\);/g, 'digitalWrite(MOTOR_IN1, LOW); digitalWrite(MOTOR_IN2, LOW); ledcWrite(0, 0);');

// Also check for any remaining RELAY_PIN test modes
c = c.replace(/digitalWrite\(RELAY_PIN, !digitalRead\(RELAY_PIN\)\);/g, '/* L298N test mode removed */');

fs.writeFileSync('esp32/fish_feeder/fish_feeder.ino', c);
console.log('Fixed stopFeeding');
