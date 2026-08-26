const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/data/app.js', 'utf8');

c = c.replace(/\} catch \(e\) \{\s*console\.error\("❌ แปลง History MQTT ล้มเหลว", e\);\s*\}\s*\}\s*\}/g, '} catch (e) { console.error("❌ แปลง History MQTT ล้มเหลว", e); } }');

fs.writeFileSync('esp32/fish_feeder/data/app.js', c);
console.log("Fixed");
