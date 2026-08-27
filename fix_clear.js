const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/data/app.js', 'utf8');

const regex = /if \(clearHistoryBtn\) \{[\s\S]*?clearHistoryBtn\.addEventListener\("click", async \(\) => \{[\s\S]*?if \(!confirm\(".*"\)\) return;[\s\S]*?try \{[\s\S]*?if \(window\.isLocalMode\) \{[\s\S]*?const response = await fetch\("\/api\/history", \{[\s\S]*?method: "DELETE",[\s\S]*?headers: \{ "x-device-id": DEVICE_ID, "x-device-code": "1234" \}[\s\S]*?\}\);[\s\S]*?if \(response\.ok\) \{[\s\S]*?alert\(".*"\);[\s\S]*?window\.loadHistory\(\);[\s\S]*?\}[\s\S]*?\} else \{[\s\S]*?if \(mqttClient && mqttClient\.connected\) \{[\s\S]*?mqttClient\.publish\(TOPIC_CMD, JSON\.stringify\(\{ action: "CLEAR_HISTORY" \}\)\);[\s\S]*?alert\(".*"\);[\s\S]*?\} else \{[\s\S]*?alert\(".*"\);[\s\S]*?\}[\s\S]*?\}[\s\S]*?\} catch \(err\) \{[\s\S]*?alert\(".*"\);[\s\S]*?\}[\s\S]*?\}\);[\s\S]*?\}/;

const newBlock = `    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener("click", async () => {
            if (!confirm("คุณต้องการล้างประวัติทั้งหมดใช่หรือไม่?")) return;

            try {
                if (window.isLocalMode) {
                    const response = await fetch("/api/history", {
                        method: "DELETE",
                        headers: { "x-device-id": DEVICE_ID, "x-device-code": "1234" }
                    });
                    if (response.ok) {
                        alert("✅ ล้างประวัติในระบบ Local เรียบร้อยแล้ว");
                        window.loadHistory();
                    }
                } else {
                    if (mqttClient && mqttClient.connected) {
                        mqttClient.publish(TOPIC_CMD, JSON.stringify({ action: "CLEAR_HISTORY" }));
                        
                        // Clear Vercel DB in Online Mode
                        await fetch("/api/history", {
                            method: "DELETE",
                            headers: { "x-device-id": DEVICE_ID, "x-device-code": "1234" }
                        });
                        lastSyncedHistoryJson = ""; // Reset sync cache
                        
                        alert("✅ ส่งคำสั่งล้างประวัติผ่านระบบออนไลน์และฐานข้อมูลเรียบร้อยแล้ว");
                        window.loadHistory();
                    } else {
                        alert("❌ ไม่สามารถเชื่อมต่อ MQTT ได้");
                    }
                }
            } catch (err) {
                alert("❌ เกิดข้อผิดพลาดในการล้างประวัติ");
            }
        });
    }`;

if (regex.test(c)) {
    c = c.replace(regex, newBlock);
    fs.writeFileSync('esp32/fish_feeder/data/app.js', c);
    console.log("Success");
} else {
    console.log("Could not find the target block.");
}
