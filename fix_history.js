const fs = require('fs');

// 1. Fix api/history.js
let api = fs.readFileSync('esp32/fish_feeder/data/api/history.js', 'utf8');
api = api.replace(/amount \|\| 10/g, 'amount !== undefined ? amount : 10');
fs.writeFileSync('esp32/fish_feeder/data/api/history.js', api);

// 2. Fix app.js historyUpdatedUI
let app = fs.readFileSync('esp32/fish_feeder/data/app.js', 'utf8');
const oldEvent = `    window.addEventListener('historyUpdatedUI', (e) => {
        if (e.detail && Array.isArray(e.detail)) {
            renderHistory(e.detail);
        }
    });`;
const newEvent = `    window.addEventListener('historyUpdatedUI', (e) => {
        if (e.detail && Array.isArray(e.detail)) {
            if (window.isLocalMode) {
                renderHistory(e.detail);
            }
            // In Online mode, do NOT render raw ESP32 data directly. 
            // The Frontend Sync logic will save it to Vercel DB and call loadHistory() automatically.
        }
    });`;
if (app.includes(oldEvent)) {
    app = app.replace(oldEvent, newEvent);
    fs.writeFileSync('esp32/fish_feeder/data/app.js', app);
    console.log("Success");
} else {
    console.log("Could not find old event block");
}
