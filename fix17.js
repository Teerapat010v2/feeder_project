const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/data/app.js', 'utf8');

c = c.replace('if (mqttClient && mqttClient.connected) {\n                        mqttClient.publish(TOPIC_CMD, JSON.stringify({ action: "CLEAR_HISTORY" }));\n                        alert("✅ ส่งคำสั่งล้างประวัติผ่านระบบออนไลน์แล้ว");\n                    }', `if (mqttClient && mqttClient.connected) {
                        mqttClient.publish(TOPIC_CMD, JSON.stringify({ action: "CLEAR_HISTORY" }));
                        
                        // Clear Vercel Postgres as well
                        try {
                            const res = await fetch("/api/history", {
                                method: "DELETE",
                                headers: { "x-device-id": DEVICE_ID }
                            });
                            if (res.ok) {
                                alert("✅ ล้างประวัติผ่านระบบออนไลน์เรียบร้อยแล้ว");
                                if(typeof window.loadHistory === 'function') window.loadHistory();
                            }
                        } catch(err) {
                            console.error(err);
                        }
                    }`);

fs.writeFileSync('esp32/fish_feeder/data/app.js', c);
console.log('Fixed clear history in online mode');
