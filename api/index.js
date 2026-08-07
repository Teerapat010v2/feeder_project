const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

// ----------------------------------------------------
// 1. Firebase Admin Initializing
// ----------------------------------------------------
try {
  if (!admin.apps.length) {
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (privateKey) {
      privateKey = privateKey.replace(/\\n/g, '\n').replace(/^"(.*)"$/, '$1');
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      }),
      databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}-default-rtdb.asia-southeast1.firebasedatabase.app`
    });
    console.log('✅ Firebase initialized successfully');
  }
} catch (error) {
  console.error('❌ Firebase Init Error:', error.message);
}

// ----------------------------------------------------
// 2. Helper Function: MQTT Publisher
// ----------------------------------------------------
function publishMQTT(topic, payload) {
  return new Promise((resolve, reject) => {
    const mqttOptions = {
      host: process.env.MQTT_HOST,
      port: parseInt(process.env.MQTT_PORT || '8883'),
      protocol: 'mqtts',
      username: process.env.MQTT_USER,
      password: process.env.MQTT_PASS,
      rejectUnauthorized: true,
      connectTimeout: 3000
    };

    const client = mqtt.connect(mqttOptions);

    const timeout = setTimeout(() => {
      client.end(true);
      reject(new Error('MQTT connection timeout'));
    }, 4000);

    client.on('connect', () => {
      client.publish(topic, payload, { qos: 1 }, (err) => {
        clearTimeout(timeout);
        client.end();
        if (err) reject(err);
        else resolve();
      });
    });

    client.on('error', (err) => {
      clearTimeout(timeout);
      client.end(true);
      reject(err);
    });
  });
}

// ----------------------------------------------------
// 3. REST API Routes
// ----------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ status: 'Online', timestamp: new Date() });
});

// 🐟 สั่งให้อาหารปลา (Feed Command)
app.post('/api/feed', async (req, res) => {
  try {
    // 🟢 ดึง deviceId จาก Body หรือ Header (x-device-id) หรือใช้ ค่าเริ่มต้น device123
    const deviceId = req.body.deviceId || req.headers['x-device-id'] || 'device123';
    // 🟢 ดึงปริมาณอาหาร รองรับทั้ง amountGrams และ grams
    const feedAmount = Number(req.body.amountGrams || req.body.grams || 10);

    let mqttSuccess = false;

    // 1. ส่งคำสั่งเข้า Firebase
    if (admin.apps.length) {
      try {
        const db = admin.database();
        await db.ref(`devices/${deviceId}/cmd_feed`).set(feedAmount);

        await db.ref(`devices/${deviceId}/logs`).push({
          action: 'FEED',
          amount: feedAmount,
          timestamp: admin.database.ServerValue.TIMESTAMP
        });
      } catch (dbErr) {
        console.error('❌ Firebase write error:', dbErr.message);
      }
    }

    // 2. พยายามส่ง MQTT สำรอง
    try {
      const topic = `fishfeeder/${deviceId}/cmd/feed`;
      const payload = JSON.stringify({ action: 'FEED', amount: feedAmount, timestamp: Math.floor(Date.now() / 1000) });
      await publishMQTT(topic, payload);
      mqttSuccess = true;
    } catch (mqttErr) {
      console.warn('⚠️ MQTT Publish skipped/timeout:', mqttErr.message);
    }

    res.json({ 
      success: true, 
      message: `Feed command sent to device: ${deviceId}`,
      mqttSent: mqttSuccess
    });
  } catch (error) {
    console.error('API /api/feed Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 🛑 สั่งหยุดฉุกเฉิน (Emergency Stop Command)
app.post('/api/stop', async (req, res) => {
  try {
    const deviceId = req.body.deviceId || req.headers['x-device-id'] || 'device123';

    if (admin.apps.length) {
      try {
        const db = admin.database();
        await db.ref(`devices/${deviceId}/cmd_feed`).set(0);
      } catch (dbErr) {
        console.error('❌ Firebase stop error:', dbErr.message);
      }
    }

    try {
      const topic = `fishfeeder/${deviceId}/cmd/stop`;
      const payload = JSON.stringify({ action: 'EMERGENCY_STOP', timestamp: Math.floor(Date.now() / 1000) });
      await publishMQTT(topic, payload);
    } catch (mqttErr) {
      console.warn('⚠️ MQTT Stop skipped/timeout:', mqttErr.message);
    }

    res.json({ success: true, message: `EMERGENCY STOP sent to device: ${deviceId}` });
  } catch (error) {
    console.error('API /api/stop Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 Smart Fish Feeder API is running on port ${PORT}`);
  });
}

module.exports = app;