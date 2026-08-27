const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/data/app.js', 'utf8');

const regex = /\/\/ บันทึกประวัติลงฐานข้อมูล Vercel Postgres[\s\S]*?try \{[\s\S]*?await fetch\('\/api\/history', \{[\s\S]*?method: 'POST',[\s\S]*?headers: \{ 'Content-Type': 'application\/json' \},[\s\S]*?body: JSON\.stringify\(\{ amount: amount, mode: 'manual' \}\)[\s\S]*?\}\);[\s\S]*?\} catch \(e\) \{[\s\S]*?console\.error\('Failed to save history:', e\);[\s\S]*?\}/;

if (regex.test(c)) {
    c = c.replace(regex, "// (การบันทึกประวัติจะถูกจัดการโดย Frontend Sync อัตโนมัติเมื่อ ESP32 ทำงานเสร็จและส่ง MQTT กลับมา)");
    fs.writeFileSync('esp32/fish_feeder/data/app.js', c);
    console.log("Success");
} else {
    console.log("Target not found");
}
