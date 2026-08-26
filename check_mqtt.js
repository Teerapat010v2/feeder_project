const mqtt = require('mqtt');
const client = mqtt.connect('mqtt://broker.hivemq.com');
client.on('connect', () => {
    console.log("Connected to HiveMQ");
    client.subscribe('fishfeeder/Prototype_01/history');
});
client.on('message', (topic, message) => {
    console.log("Received:", message.toString());
    process.exit(0);
});
setTimeout(() => {
    console.log("Timeout waiting for MQTT");
    process.exit(1);
}, 10000);
