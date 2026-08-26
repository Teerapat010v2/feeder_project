const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/data/app.js', 'utf8');

let syncLogic = `
            } else if (topic === TOPIC_HISTORY) {
                try {
                    const data = JSON.parse(message.toString());
                    let payloadHistory = [];
                    if (Array.isArray(data)) {
                        payloadHistory = data;
                        
                        // SYNC TO VERCEL POSTGRES (Frontend Sync)
                        if (!window.isLocalMode && payloadHistory.length > 0) {
                            try {
                                const res = await fetch("/api/history", {
                                    headers: { "x-device-id": DEVICE_ID, "x-device-code": "1234" }
                                });
                                if (res.ok) {
                                    const dbHistory = await res.json();
                                    // Check for missing entries
                                    for(let item of payloadHistory) {
                                        // Simple heuristic: if db doesn't have this timestamp, post it.
                                        let exists = dbHistory.some(dbItem => {
                                            const t1 = new Date(dbItem.timestamp).getTime();
                                            const t2 = new Date(item.timestamp).getTime();
                                            return Math.abs(t1 - t2) < 60000; // within 1 minute
                                        });
                                        if(!exists && item.amount > 0) {
                                            console.log("Syncing missing history to DB:", item);
                                            await fetch('/api/history', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json', 'x-device-id': DEVICE_ID },
                                                body: JSON.stringify({ amount: item.amount, mode: item.mode, timestamp: item.timestamp })
                                            });
                                        }
                                    }
                                    // Refresh UI from DB after sync
                                    setTimeout(() => {
                                        if(typeof loadHistory === 'function') loadHistory();
                                    }, 1000);
                                }
                            } catch(err) {
                                console.error("Sync history failed", err);
                            }
                        }
                    }
                    window.dispatchEvent(new CustomEvent('historyUpdatedUI', { detail: payloadHistory }));
                } catch (e) {}
`;

c = c.replace(/} else if \(topic === TOPIC_HISTORY\) \{[\s\S]*?catch \(e\) \{\}/, syncLogic.trim());

fs.writeFileSync('esp32/fish_feeder/data/app.js', c);
console.log('Added frontend history sync');
