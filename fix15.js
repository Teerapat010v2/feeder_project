const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/data/app.js', 'utf8');
c = c.replace('async function loadHistory() {', 'window.loadHistory = async function() {');
c = c.replace("if(typeof loadHistory === 'function') loadHistory();", "if(typeof window.loadHistory === 'function') window.loadHistory();");
c = c.replace(/loadHistory\(\);/g, 'window.loadHistory();');
fs.writeFileSync('esp32/fish_feeder/data/app.js', c);
console.log('Fixed loadHistory scope');
