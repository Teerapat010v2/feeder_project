const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/fish_feeder.ino', 'utf8');

let replacement = `  digitalWrite(MOTOR_IN1, HIGH); digitalWrite(MOTOR_IN2, LOW); 
  int pwmValue = map(currentMotorSpeed, 0, 100, 0, 255);
  ledcWrite(0, pwmValue);
  Serial.print("▶️ มอเตอร์เริ่มหมุนด้วยความเร็ว: ");
  Serial.print(currentMotorSpeed);
  Serial.print("% (PWM: ");
  Serial.print(pwmValue);
  Serial.println(")");
`;
c = c.replace(/digitalWrite\(MOTOR_IN1, HIGH\); digitalWrite\(MOTOR_IN2, LOW\); ledcWrite\(0, map\(currentMotorSpeed, 0, 100, 0, 255\)\);/g, replacement);

fs.writeFileSync('esp32/fish_feeder/fish_feeder.ino', c);
console.log('Added Serial debug for motor speed');
