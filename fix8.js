const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/fish_feeder.ino', 'utf8');
c += `
void handleSetSpeed() {
  if (server.hasArg("speed")) {
    currentMotorSpeed = server.arg("speed").toInt();
    if(currentMotorSpeed < 0) currentMotorSpeed = 0;
    if(currentMotorSpeed > 100) currentMotorSpeed = 100;
    preferences.begin("motor_config", false);
    preferences.putInt("speed", currentMotorSpeed);
    preferences.end();
    server.send(200, "application/json", "{\\"success\\":true,\\"message\\":\\"Speed updated\\"}");
  } else {
    server.send(400, "application/json", "{\\"success\\":false,\\"message\\":\\"Missing speed\\"}");
  }
}
`;
fs.writeFileSync('esp32/fish_feeder/fish_feeder.ino', c);
console.log('Appended handleSetSpeed');
