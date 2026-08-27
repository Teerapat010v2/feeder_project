const fs = require('fs');

let app = fs.readFileSync('esp32/fish_feeder/data/app.js', 'utf8');

const regex = /window\.addEventListener\('historyUpdatedUI', \(e\) => \{\s*if \(e\.detail && Array\.isArray\(e\.detail\)\) \{\s*renderHistory\(e\.detail\);\s*\}\s*\}\);/g;
const newEvent = `window.addEventListener('historyUpdatedUI', (e) => {
        if (e.detail && Array.isArray(e.detail)) {
            if (window.isLocalMode) {
                renderHistory(e.detail);
            }
        }
    });`;

if (regex.test(app)) {
    // Only replace the LAST match
    const matches = app.match(regex);
    const lastMatch = matches[matches.length - 1];
    
    // Find the last index of the match
    const lastIndex = app.lastIndexOf(lastMatch);
    
    app = app.substring(0, lastIndex) + newEvent + app.substring(lastIndex + lastMatch.length);
    
    fs.writeFileSync('esp32/fish_feeder/data/app.js', app);
    console.log("Success app.js");
} else {
    console.log("Regex didn't match anything");
}
