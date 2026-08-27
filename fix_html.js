const fs = require('fs');
let c = fs.readFileSync('esp32/fish_feeder/data/index.html', 'utf8');

c = c.replace('<span class="status-label">มอเตอร์:</span>\r\n                        \r\n                    </div>', '<span class="status-label">มอเตอร์:</span>\r\n                        <span id="statusMotor" class="status-value-text gray">100%</span>\r\n                    </div>');

c = c.replace('<span class="status-label">มอเตอร์:</span>\n                        \n                    </div>', '<span class="status-label">มอเตอร์:</span>\n                        <span id="statusMotor" class="status-value-text gray">100%</span>\n                    </div>');

fs.writeFileSync('esp32/fish_feeder/data/index.html', c);
console.log("Success");
