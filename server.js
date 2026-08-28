// server.js - Firebase Backend Bridge for ESP32 Safety Monitor
// This runs on your server (VPS, Raspberry Pi, or cloud) - NEVER in the browser

const admin = require('firebase-admin');
const express = require('express');
const mqtt = require('mqtt');
const cors = require('cors');

// ===================== CONFIG =====================
// 1. Place your downloaded service account JSON in the same folder as this file
// 2. Rename it to: serviceAccountKey.json
//    OR use the exact filename you have: safetymonitor-d2303-firebase-adminsdk-fbsvc-733049f934.json

const SERVICE_ACCOUNT_PATH = './safetymonitor-d2303-firebase-adminsdk-fbsvc-733049f934.json';

// MQTT Config (same as your dashboard)
const MQTT_BROKER = 'wss://broker.hivemq.com:8884/mqtt';
const MQTT_TOPICS = {
    CAM_MOTION: 'esp32cam/motion',
    CAM_FIRE: 'esp32cam/fire',
    CAM_GPS: 'esp32cam/gps',
    MAIN_SENSORS: 'esp32main/sensors',
    MAIN_SOS: 'esp32main/sos',
    DASHBOARD_SOS: 'dashboard/sos'
};

// Alert thresholds
const ALERT_THRESHOLDS = {
    methane: 500,    // PPM
    co: 300,         // PPM
    temperature: 60  // °C
};

// ===================== INIT FIREBASE ADMIN =====================
const serviceAccount = require(SERVICE_ACCOUNT_PATH);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const messaging = admin.messaging();

console.log('✅ Firebase Admin SDK initialized');
console.log('📁 Project:', serviceAccount.project_id);

// ===================== EXPRESS SERVER =====================
const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'running', 
        project: serviceAccount.project_id,
        firebase: 'connected',
        mqtt: mqttClient ? (mqttClient.connected ? 'connected' : 'disconnected') : 'not initialized'
    });
});

// API: Receive sensor data directly from ESP32 via HTTP POST
app.post('/api/sensor', async (req, res) => {
    try {
        const data = req.body;
        console.log('📡 HTTP Sensor Data:', data);

        // Save to Firestore
        await saveSensorData(data);

        // Check alerts
        await checkAndAlert(data);

        res.json({ success: true, saved: true });
    } catch (err) {
        console.error('❌ Sensor API error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Send manual alert from dashboard or external system
app.post('/api/alert', async (req, res) => {
    try {
        const { title, body, topic = 'safety_alerts' } = req.body;
        await sendFCMAlert(title, body, topic);
        res.json({ success: true, sent: true });
    } catch (err) {
        console.error('❌ Alert API error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// API: Get recent sensor history
app.get('/api/history', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const snapshot = await db.collection('sensor_logs')
            .orderBy('timestamp', 'desc')
            .limit(limit)
            .get();

        const data = [];
        snapshot.forEach(doc => {
            const d = doc.data();
            data.push({
                id: doc.id,
                ...d,
                timestamp: d.timestamp ? d.timestamp.toDate().toISOString() : null
            });
        });

        res.json({ success: true, count: data.length, data });
    } catch (err) {
        console.error('❌ History API error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Start HTTP server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🌐 HTTP API running on port ${PORT}`);
    console.log(`   GET  http://localhost:${PORT}/`);
    console.log(`   POST http://localhost:${PORT}/api/sensor`);
    console.log(`   POST http://localhost:${PORT}/api/alert`);
    console.log(`   GET  http://localhost:${PORT}/api/history`);
});

// ===================== MQTT BRIDGE =====================
// This connects to the same MQTT broker as your dashboard and bridges data to Firestore

const mqttClient = mqtt.connect(MQTT_BROKER, {
    clientId: 'backend-bridge-' + Math.random().toString(16).substr(2, 8),
    clean: true,
    reconnectPeriod: 5000
});

mqttClient.on('connect', () => {
    console.log('✅ MQTT Bridge connected to HiveMQ');
    Object.values(MQTT_TOPICS).forEach(topic => {
        mqttClient.subscribe(topic);
        console.log('   📥 Subscribed:', topic);
    });
});

mqttClient.on('message', async (topic, message) => {
    const payload = message.toString();

    try {
        switch(topic) {
            case MQTT_TOPICS.MAIN_SENSORS:
                const sensorData = JSON.parse(payload);
                await saveSensorData(sensorData);
                await checkAndAlert(sensorData);
                break;

            case MQTT_TOPICS.CAM_MOTION:
                if (payload === 'true') {
                    await sendFCMAlert(
                        '🚨 Motion Detected',
                        'Movement detected by ESP32-CAM',
                        'safety_alerts'
                    );
                    await saveEventLog('motion', 'Motion detected by camera');
                }
                break;

            case MQTT_TOPICS.CAM_FIRE:
                if (payload === 'true') {
                    await sendFCMAlert(
                        '🔥 FIRE DETECTED!',
                        'Fire detected! Evacuate immediately!',
                        'safety_alerts'
                    );
                    await saveEventLog('fire', 'Fire detected by camera');
                }
                break;

            case MQTT_TOPICS.MAIN_SOS:
                if (payload === 'true') {
                    await sendFCMAlert(
                        '🆘 SOS EMERGENCY',
                        'Panic button triggered on ESP32 device',
                        'safety_alerts'
                    );
                    await saveEventLog('sos', 'SOS button pressed on device');
                }
                break;

            case MQTT_TOPICS.DASHBOARD_SOS:
                if (payload === 'true') {
                    await sendFCMAlert(
                        '🆘 DASHBOARD SOS',
                        'SOS triggered from web dashboard',
                        'safety_alerts'
                    );
                    await saveEventLog('sos', 'SOS triggered from dashboard');
                }
                break;

            case MQTT_TOPICS.CAM_GPS:
                try {
                    const gps = JSON.parse(payload);
                    if (gps.valid) {
                        await db.collection('gps_logs').add({
                            lat: gps.lat,
                            lng: gps.lng,
                            sats: gps.sats || 0,
                            timestamp: admin.firestore.FieldValue.serverTimestamp()
                        });
                    }
                } catch (e) {}
                break;
        }
    } catch (err) {
        console.error('❌ MQTT handler error:', err);
    }
});

mqttClient.on('error', (err) => {
    console.error('❌ MQTT Bridge error:', err.message);
});

mqttClient.on('close', () => {
    console.log('⚠️ MQTT Bridge disconnected. Reconnecting...');
});

// ===================== HELPER FUNCTIONS =====================

async function saveSensorData(data) {
    const docData = {
        methane: data.methane || 0,
        co: data.co || 0,
        temperature: data.temperature !== undefined ? data.temperature : null,
        humidity: data.humidity !== undefined ? data.humidity : null,
        danger_alert: data.danger_alert || false,
        source: data.source || 'mqtt',
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('sensor_logs').add(docData);
    console.log('💾 Sensor data saved to Firestore');
}

async function saveEventLog(type, message) {
    await db.collection('event_logs').add({
        type,
        message,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
}

async function checkAndAlert(data) {
    const alerts = [];

    if (data.methane > ALERT_THRESHOLDS.methane) {
        alerts.push(`Methane critical: ${data.methane} PPM`);
    }
    if (data.co > ALERT_THRESHOLDS.co) {
        alerts.push(`CO/Gas critical: ${data.co} PPM`);
    }
    if (data.temperature > ALERT_THRESHOLDS.temperature) {
        alerts.push(`Temperature critical: ${data.temperature}°C`);
    }
    if (data.danger_alert) {
        alerts.push('Hazardous conditions detected!');
    }

    if (alerts.length > 0) {
        const title = '⚠️ HAZARD ALERT';
        const body = alerts.join(' | ');
        await sendFCMAlert(title, body, 'safety_alerts');
        console.log('🔔 Alert sent:', body);
    }
}

async function sendFCMAlert(title, body, topic = 'safety_alerts') {
    try {
        const message = {
            notification: {
                title: title,
                body: body
            },
            topic: topic,
            android: {
                priority: 'high',
                notification: {
                    channelId: 'safety_alerts',
                    sound: 'default',
                    priority: 'high'
                }
            },
            apns: {
                payload: {
                    aps: {
                        alert: { title, body },
                        sound: 'default',
                        badge: 1
                    }
                }
            },
            webpush: {
                notification: {
                    title: title,
                    body: body,
                    icon: 'https://cdn-icons-png.flaticon.com/512/2964/2964514.png',
                    requireInteraction: true
                },
                fcmOptions: {
                    link: '/'
                }
            }
        };

        const response = await messaging.send(message);
        console.log('📲 FCM Alert sent:', response);

    } catch (err) {
        console.error('❌ FCM send failed:', err.message);
    }
}

// Also support sending to specific tokens
async function sendFCMToToken(title, body, token) {
    try {
        const message = {
            notification: { title, body },
            token: token,
            android: { priority: 'high' },
            apns: { payload: { aps: { alert: { title, body }, sound: 'default' } } },
            webpush: {
                notification: { title, body, requireInteraction: true }
            }
        };
        await messaging.send(message);
    } catch (err) {
        console.error('❌ FCM token send failed:', err.message);
    }
}

console.log('\n🚀 ESP32 Safety Backend starting...');
console.log('=====================================');
