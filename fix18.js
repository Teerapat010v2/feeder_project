const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/data/app.js', 'utf8');
let target = `} else if (topic === TOPIC_HISTORY) {
                try {
                    const data = JSON.parse(message.toString());
                    let payloadHistory = [];
                    if (Array.isArray(data)) {
                        payloadHistory = data;
                    }
                    const historyEvent = new CustomEvent('historyUpdatedUI', { detail: payloadHistory });
                    window.dispatchEvent(historyEvent);
                } catch (e) {
                    console.error("❌ พังตอนแปลง History MQTT", e);
                }
            }`;

let replacement = `} else if (topic === TOPIC_HISTORY) {
                try {
                    const data = JSON.parse(message.toString());
                    let payloadHistory = [];
                    if (Array.isArray(data)) {
                        payloadHistory = data;
                        
                        // SYNC TO VERCEL POSTGRES (Frontend Sync)
                        if (!window.isLocalMode && payloadHistory.length > 0) {
                            (async () => {
                                try {
                                    const res = await fetch("/api/history", {
                                        headers: { "x-device-id": DEVICE_ID, "x-device-code": "1234" }
                                    });
                                    if (res.ok) {
                                        const dbHistory = await res.json();
                                        let synced = false;
                                        for(let item of payloadHistory) {
                                            let exists = dbHistory.some(dbItem => {
                                                const t1 = new Date(dbItem.timestamp).getTime();
                                                const t2 = new Date(item.timestamp).getTime();
                                                return Math.abs(t1 - t2) < 60000;
                                            });
                                            if(!exists && item.amount > 0) {
                                                console.log("Syncing missing history to DB:", item);
                                                await fetch('/api/history', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json', 'x-device-id': DEVICE_ID },
                                                    body: JSON.stringify({ amount: item.amount, mode: item.mode, timestamp: item.timestamp })
                                                });
                                                synced = true;
                                            }
                                        }
                                        if (synced && typeof window.loadHistory === 'function') {
                                            setTimeout(() => window.loadHistory(), 1000);
                                        }
                                    }
                                } catch(err) {
                                    console.error("Sync history failed", err);
                                }
                            })();
                        }
                    }
                    const historyEvent = new CustomEvent('historyUpdatedUI', { detail: payloadHistory });
                    window.dispatchEvent(historyEvent);
                } catch (e) {
                    console.error("❌ พังตอนแปลง History MQTT", e);
                }
            }`;

c = c.replace(target, replacement);
fs.writeFileSync('esp32/fish_feeder/data/app.js', c);
console.log('Fixed sync logic');
