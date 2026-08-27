const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/data/app.js', 'utf8');

const target = "const motorSpeedText = data.motor_speed !== undefined ? `พร้อม (${data.motor_speed}%)` : \"พร้อม\";";
const replacement = "const motorSpeedText = data.motor_speed !== undefined ? `${data.motor_speed}%` : \"100%\";";

if (c.includes(target)) {
    c = c.replace(target, replacement);
    fs.writeFileSync('esp32/fish_feeder/data/app.js', c);
    console.log("Success");
} else {
    console.log("Target not found");
}
