const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/data/app.js', 'utf8');

// Add variables
c = c.replace('const modeToggle = document.getElementById("modeToggle");', 'const modeToggle = document.getElementById("modeToggle");\n    const motorSpeedSlider = document.getElementById("motorSpeedSlider");\n    const motorSpeedValueText = document.getElementById("motorSpeedValueText");\n    const saveMotorSpeedBtn = document.getElementById("saveMotorSpeedBtn");');

// In updateDashboardUI
c = c.replace('let motor = "READY";', 'let motor = "READY";\n        let motorSpeed = 100;');
c = c.replace('motor = data.motor || "READY";', 'motor = data.motor || "READY";\n            if (data.motor_speed !== undefined) motorSpeed = data.motor_speed;');
let uiUpdate = `
        if (motorSpeedSlider && motorSpeedValueText) {
            motorSpeedSlider.value = motorSpeed;
            motorSpeedValueText.textContent = motorSpeed;
        }
`;
c = c.replace('// --- 4. อัปเดต Progress Bar ---', uiUpdate + '\n        // --- 4. อัปเดต Progress Bar ---');

// Add Event Listeners
let listeners = `
    // --- ตั้งค่ามอเตอร์ (L298N) ---
    if (motorSpeedSlider && motorSpeedValueText) {
        motorSpeedSlider.addEventListener("input", (e) => {
            motorSpeedValueText.textContent = e.target.value;
        });
    }

    if (saveMotorSpeedBtn && motorSpeedSlider) {
        saveMotorSpeedBtn.addEventListener("click", () => {
            const speed = motorSpeedSlider.value;
            const prevText = saveMotorSpeedBtn.innerHTML;
            saveMotorSpeedBtn.innerHTML = "กำลังบันทึก...";
            saveMotorSpeedBtn.disabled = true;

            if (window.isLocalMode) {
                fetch("/api/set-speed?speed=" + speed)
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        alert("ตั้งค่าความเร็วมอเตอร์สำเร็จ");
                    }
                })
                .catch(e => {
                    alert("บันทึกไม่สำเร็จ (Local)");
                })
                .finally(() => {
                    saveMotorSpeedBtn.innerHTML = prevText;
                    saveMotorSpeedBtn.disabled = false;
                });
            } else {
                if (typeof mqttClient !== 'undefined' && mqttClient.connected) {
                    const payload = { action: "SET_SPEED", speed: Number(speed) };
                    mqttClient.publish(DEVICE_ID + "/command", JSON.stringify(payload));
                    setTimeout(() => {
                        alert("ส่งคำสั่งความเร็วมอเตอร์สำเร็จ");
                        saveMotorSpeedBtn.innerHTML = prevText;
                        saveMotorSpeedBtn.disabled = false;
                    }, 500);
                } else {
                    alert("ไม่ได้เชื่อมต่อ MQTT (ระบบออฟไลน์)");
                    saveMotorSpeedBtn.innerHTML = prevText;
                    saveMotorSpeedBtn.disabled = false;
                }
            }
        });
    }
`;

c = c.replace('// --- ฟังก์ชัน Helper สำหรับ Schedule ---', listeners + '\n\n    // --- ฟังก์ชัน Helper สำหรับ Schedule ---');

fs.writeFileSync('esp32/fish_feeder/data/app.js', c);
console.log('Fixed app.js for Motor Control');
