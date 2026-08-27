const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/data/app.js', 'utf8');

const regex = /if \(motorEl\) \{[\s\S]*?if \(!onlineStatus\) \{[\s\S]*?motorEl\.textContent = "เครื่องปิด";[\s\S]*?motorEl\.className = "status-value-text gray";[\s\S]*?\} else \{[\s\S]*?motorEl\.textContent = motor === "FEEDING" \? "ทำงาน" : \(motor === "ERROR" \? "ขัดข้อง" : "พร้อม"\);[\s\S]*?motorEl\.className = motor === "FEEDING" \? "status-value-text blue" : \(motor === "ERROR" \? "status-value-text red" : "status-value-text green"\);[\s\S]*?\}[\s\S]*?\}/;

const replacement = `if (motorEl) {
            if (!onlineStatus) {
                motorEl.textContent = "เครื่องปิด";
                motorEl.className = "status-value-text gray";
            } else {
                const motorSpeedText = data.motor_speed !== undefined ? \`พร้อม (\${data.motor_speed}%)\` : "พร้อม";
                motorEl.textContent = motor === "FEEDING" ? "ทำงาน" : (motor === "ERROR" ? "ขัดข้อง" : motorSpeedText);
                motorEl.className = motor === "FEEDING" ? "status-value-text blue" : (motor === "ERROR" ? "status-value-text red" : "status-value-text green");
            }
        }
        
        // Sync motor speed slider with device state to prevent reset on refresh
        if (onlineStatus && data.motor_speed !== undefined) {
            if (motorSpeedSlider && document.activeElement !== motorSpeedSlider) {
                motorSpeedSlider.value = data.motor_speed;
                if (motorSpeedValueText) motorSpeedValueText.textContent = data.motor_speed;
            }
        }`;

if (regex.test(c)) {
    c = c.replace(regex, replacement);
    fs.writeFileSync('esp32/fish_feeder/data/app.js', c);
    console.log("Success");
} else {
    console.log("Target not found");
}
