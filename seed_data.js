const mqtt = require("mqtt");

const client = mqtt.connect("mqtts://97a545ab69f44dde939442a2b857bc3b.s1.eu.hivemq.cloud:8883", {
    username: "teerapat",
    password: "Teerapat99",
    clientId: "dummy-seeder-" + Math.random().toString(16).substr(2, 8),
    rejectUnauthorized: false
});

const DEVICE_ID = "Prototype_01";
const TOPIC_HISTORY = `fishfeeder/${DEVICE_ID}/history`;

client.on("connect", async () => {
    console.log("Connected to MQTT. Seeding data...");

    for (let i = 1; i <= 20; i++) {
        const payload = {
            amount: 10 + Math.floor(Math.random() * 20), // random between 10-30
            mode: i % 2 === 0 ? "manual" : "auto",
            timestamp: new Date().toISOString()
        };
        
        client.publish(TOPIC_HISTORY, JSON.stringify(payload), { qos: 1 }, (err) => {
            if (err) console.error("Error:", err);
            else console.log(`Published record ${i}`);
        });

        // Small delay to ensure order
        await new Promise(r => setTimeout(r, 200));
    }
    
    setTimeout(() => {
        client.end();
        console.log("Seeding complete.");
    }, 2000);
});
