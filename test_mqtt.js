require('dotenv').config();
const mqttClient = require('./server/mqtt.js');

async function run() {
    console.log("Connecting...");
    // Give it a second to connect
    await new Promise(r => setTimeout(r, 2000));
    
    console.log("Publishing test schedule...");
    const testSchedules = [
        { time: "08:00", amount: 10, enable: true },
        { time: "23:50", amount: 13, enable: true }
    ];
    
    // We can't call schedule() directly because it calls database.saveSchedules which needs DB config.
    // Let's just test the publish part.
    // wait, publish is not exported. I will just import mqtt library directly.
    const mqtt = require('mqtt');
    const client = mqtt.connect("mqtts://c868018e69884e93bb22271dfcb88f72.s1.eu.hivemq.cloud:8883", {
        username: "feeder_user",
        password: "FeederPassword123"
    });
    
    client.on("connect", () => {
        console.log("Connected to HiveMQ. Publishing...");
        client.publish("fishfeeder/Prototype_01/schedule", JSON.stringify({schedules: testSchedules}), {qos: 1, retain: true}, (err) => {
            if(err) console.error(err);
            else console.log("Published successfully.");
            process.exit(0);
        });
    });
}

run();
