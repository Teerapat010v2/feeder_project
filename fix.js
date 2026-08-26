const fs = require('fs');
let content = fs.readFileSync('esp32/fish_feeder/data/app.js', 'utf8');
content = content.replace(/document\.addEventListener\("DOMContentLoaded", \(\) => \{/g, '(function() {');
content = content.replace(/\}\);\r?\n/g, '})();\n');
fs.writeFileSync('esp32/fish_feeder/data/app.js', content);
console.log('Fixed!');
