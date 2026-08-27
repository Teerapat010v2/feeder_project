const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/data/app.js', 'utf8');

c = c.replace(/let mqttClient = null;/, 'let mqttClient = null;\nlet lastSyncedHistoryJson = "";');

const oldRegex = /\/\/ SYNC TO VERCEL POSTGRES \(Frontend Sync\)[\s\S]*?if \(!window\.isLocalMode && payloadHistory\.length > 0\) \{[\s\S]*?\(async \(\) => \{[\s\S]*?try \{[\s\S]*?const res = await fetch\("\/api\/history", \{[\s\S]*?headers: \{ "x-device-id": DEVICE_ID, "x-device-code": "1234" \}[\s\S]*?\}\);[\s\S]*?if \(res\.ok\) \{[\s\S]*?const dbHistory = await res\.json\(\);[\s\S]*?let synced = false;[\s\S]*?for\(let item of payloadHistory\) \{[\s\S]*?let exists = dbHistory\.some\(dbItem => \{[\s\S]*?const t1 = new Date\(dbItem\.timestamp\)\.getTime\(\);[\s\S]*?const t2 = new Date\(item\.timestamp\)\.getTime\(\);[\s\S]*?return Math\.abs\(t1 - t2\) < 60000;[\s\S]*?\}\);/;

const newSyncLogic = `// SYNC TO VERCEL POSTGRES (Frontend Sync)
                        const currentHistoryJson = JSON.stringify(payloadHistory);
                        if (!window.isLocalMode && payloadHistory.length > 0 && currentHistoryJson !== lastSyncedHistoryJson) {
                            lastSyncedHistoryJson = currentHistoryJson;
                            (async () => {
                                try {
                                    const res = await fetch("/api/history", {
                                        headers: { "x-device-id": DEVICE_ID, "x-device-code": "1234" }
                                    });
                                    if (res.ok) {
                                        const dbHistory = await res.json();
                                        let synced = false;
                                        for(let item of payloadHistory) {
                                            // Check using raw_ts directly matching ESP32's exact timestamp string
                                            let exists = dbHistory.some(dbItem => dbItem.raw_ts === item.timestamp);`;

if (oldRegex.test(c)) {
    c = c.replace(oldRegex, newSyncLogic);
    fs.writeFileSync('esp32/fish_feeder/data/app.js', c);
    console.log("Success");
} else {
    console.log("Could not find old sync logic block to replace.");
}
