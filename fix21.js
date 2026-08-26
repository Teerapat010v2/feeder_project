const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/data/app.js', 'utf8');

c = c.replace(/if\(!exists && item\.amount > 0\) \{/g, 'if(!exists) {');

fs.writeFileSync('esp32/fish_feeder/data/app.js', c);
console.log("Removed amount > 0 check");
