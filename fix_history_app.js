const fs = require('fs');

let app = fs.readFileSync('esp32/fish_feeder/data/app.js', 'utf8');
const oldEventRegex = /window\.addEventListener\('historyUpdatedUI', \(e\) => \{[\s\S]*?if \(e\.detail && Array\.isArray\(e\.detail\)\) \{[\s\S]*?renderHistory\(e\.detail\);[\s\S]*?\}[\s\S]*?\}\);/;
const newEvent = `window.addEventListener('historyUpdatedUI', (e) => {
        if (e.detail && Array.isArray(e.detail)) {
            if (window.isLocalMode) {
                renderHistory(e.detail);
            }
        }
    });`;
if (oldEventRegex.test(app)) {
    app = app.replace(oldEventRegex, newEvent);
    fs.writeFileSync('esp32/fish_feeder/data/app.js', app);
    console.log("Success app.js");
} else {
    console.log("Could not find old event block in app.js");
}
