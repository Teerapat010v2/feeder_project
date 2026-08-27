const fs = require('fs');
let api = fs.readFileSync('esp32/fish_feeder/data/api/history.js', 'utf8');

api = api.replace(/amount \|\| 10/g, 'amount !== undefined ? amount : 10');

fs.writeFileSync('esp32/fish_feeder/data/api/history.js', api);
console.log("Success api/history.js");
