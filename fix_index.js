const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/data/index.html', 'utf8');

c = c.replace('<span id="statusMotor" class="status-value-text gray">พร้อม</span>', '<span id="statusMotor" class="status-value-text gray">100%</span>');

fs.writeFileSync('esp32/fish_feeder/data/index.html', c);
console.log("Success index.html");
