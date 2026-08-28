// =====================================
// REAL-TIME WEIGHT & FEED CONTROL (DUAL MODE: LOCAL & ONLINE)
// =====================================
const DEVICE_ID = "Prototype_01";

// --- ตรวจสอบว่าเป็นโหมด Online หรือ Local ---
window.isLocalMode = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(window.location.hostname);

// --- ตั้งค่า HiveMQ (สำหรับ Online Mode) ---
const MQTT_BROKER = "wss://97a545ab69f44dde939442a2b857bc3b.s1.eu.hivemq.cloud:8884/mqtt";
const MQTT_OPTIONS = {
    username: "teerapat",
    password: "Teerapat99",
    clientId: "dashboard_" + Math.random().toString(16).substr(2, 8)
};

const TOPIC_STATUS = `fishfeeder/${DEVICE_ID}/status`;
const TOPIC_CMD = `fishfeeder/${DEVICE_ID}/cmd/command`;
const TOPIC_SCHEDULE = `fishfeeder/${DEVICE_ID}/schedule`;
const TOPIC_HISTORY = `fishfeeder/${DEVICE_ID}/history`;

let mqttClient = null;
let lastSyncedHistoryJson = "";

document.addEventListener("DOMContentLoaded", () => {
    // --- 1. ประกาศตัวแปร DOM Elements จาก index.html ---
    const tankWeightText = document.getElementById("tankWeightText");
    const tankProgressBar = document.getElementById("tankProgressBar");
    const daysRemainingText = document.getElementById("daysRemainingText");
    const foodStatusBadge = document.getElementById("foodStatusBadge");
    const connStatus = document.getElementById("connectionStatus");
    
    const feedBtn = document.getElementById("feedBtn");
    const stopBtn = document.getElementById("stopBtn");
    const feedAmount = document.getElementById("feedAmount");
    const modeToggle = document.getElementById("modeToggle");
    const motorSpeedSlider = document.getElementById("motorSpeedSlider");
    const motorSpeedValueText = document.getElementById("motorSpeedValueText");
    const saveMotorSpeedBtn = document.getElementById("saveMotorSpeedBtn");

    const MAX_CAPACITY_GRAMS = 5000;
    let DAILY_USAGE_GRAMS = 20; // Default fallback

    function updateDailyUsage(scheds) {
        let total = 0;
        if (Array.isArray(scheds)) {
            scheds.forEach(s => {
                if (s.enable) {
                    total += Number(s.amount || 0);
                }
            });
        }
        DAILY_USAGE_GRAMS = total;
        recalculateDaysRemaining();
    }

    window.addEventListener('scheduleUpdatedUI', (e) => {
        if (document.getElementById("daysRemainingText")) {
            updateDailyUsage(e.detail);
        }
    });

    if (window.isLocalMode) {
        // Local Mode fetch schedules on load
        fetch("/api/schedule").then(r => r.json()).then(data => {
            const scheds = Array.isArray(data) ? data : (data.schedules || []);
            if (document.getElementById("daysRemainingText")) {
                updateDailyUsage(scheds);
            }
        }).catch(e => console.warn(e));
    }

    let lastWeight = 0;

    function recalculateDaysRemaining() {
        const daysRemainingText = document.getElementById("daysRemainingText");
        const foodStatusBadge = document.getElementById("foodStatusBadge");

        let daysLeftVal = 0;
        if (daysRemainingText) {
            if (DAILY_USAGE_GRAMS > 0) {
                const daysLeft = (lastWeight / DAILY_USAGE_GRAMS);
                daysLeftVal = daysLeft;
                daysRemainingText.textContent = `${lastWeight > 0 ? daysLeft.toFixed(1) : "0.0"} วัน`;
            } else {
                daysLeftVal = 99; // No schedules = practically infinite days
                daysRemainingText.textContent = "ไม่ได้ตั้งเวลา";
            }
        }

        if (foodStatusBadge) {
            if (daysLeftVal > 7) {
                foodStatusBadge.textContent = "🟢 ปกติ";
                foodStatusBadge.className = "status-badge green";
            } else if (daysLeftVal >= 3) {
                foodStatusBadge.textContent = "🟡 เหลือน้อย";
                foodStatusBadge.className = "status-badge warning";
            } else {
                foodStatusBadge.textContent = "🔴 เติมอาหาร";
                foodStatusBadge.className = "status-badge red";
            }
        }
    }

    // Fetch schedules to calculate real daily usage
    fetch("/api/schedule").then(res => res.json()).then(data => {
        if (Array.isArray(data)) {
            let usage = 0;
            for (let s of data) {
                if (s.enable) usage += Number(s.amount);
            }
            if (usage > 0) {
                DAILY_USAGE_GRAMS = usage;
                recalculateDaysRemaining();
            }
        }
    }).catch(err => console.log("Could not fetch schedules for daily usage"));
    
    let localFetchTimer = null;
    let isModeUpdating = false;
    let currentDeviceOnline = false;

    // --- ฟังก์ชันอัปเดต UI หน้าจอ ---
    function updateDashboardUI(data, isOnline) {
        let weight = 0;
        let mode = "MANUAL";
        let motor = "READY";
        let motorSpeed = 100;
        let scaleStat = "NORMAL";
        let onlineStatus = isOnline;
        
        if (typeof data === 'number') {
            weight = Math.max(0, parseFloat(data || 0));
        } else if (data) {
            weight = Math.max(0, parseFloat(data.current_weight || 0));
            if (data.mode) mode = data.mode.toUpperCase();
            if (data.motor_status) motor = data.motor_status.toUpperCase();
            if (data.scale_status) scaleStat = data.scale_status.toUpperCase();
            if (data.online !== undefined) onlineStatus = data.online;
        }

        currentDeviceOnline = onlineStatus;

        if (connStatus) {
            if (onlineStatus) {
                connStatus.className = window.isLocalMode ? "status-badge local" : "status-badge online"; // will style .online in css
                connStatus.innerText = window.isLocalMode ? "● Local" : "● Online";
            } else {
                connStatus.className = "status-badge offline";
                connStatus.innerText = "● Offline";
            }
        }

        if (tankWeightText) tankWeightText.textContent = `${weight.toFixed(1)} g`;

        if (tankProgressBar) {
            const percent = Math.min(Math.max((weight / MAX_CAPACITY_GRAMS) * 100, 0), 100);
            tankProgressBar.style.width = `${percent}%`;
        }

        lastWeight = weight;
        recalculateDaysRemaining();
        
        // Update new status fields
        const modeEl = document.getElementById("statusCurrentMode");
        const motorEl = document.getElementById("statusMotor");
        const scaleEl = document.getElementById("statusSensor");
        
        // Handle Mode Toggle (Ignore if isModeUpdating is true)
        if (!isModeUpdating && data.mode) {
            const currentIsManual = data.mode.toUpperCase() === "MANUAL";
            if (modeToggle && modeToggle.checked !== currentIsManual) {
                modeToggle.checked = currentIsManual;
                updateModeUI(currentIsManual, onlineStatus);
            }
        }

        if (modeEl) {
            if (!onlineStatus) {
                modeEl.textContent = "เครื่องปิด";
                modeEl.className = "status-value-text gray";
            } else {
                const isManual = modeToggle ? modeToggle.checked : (mode === "MANUAL");
                modeEl.textContent = isManual ? "Manual" : "Auto";
                modeEl.className = isManual ? "status-value-text warning" : "status-value-text green";
            }
        }
        if (motorEl) {
            if (!onlineStatus) {
                motorEl.textContent = "เครื่องปิด";
                motorEl.className = "status-value-text gray";
            } else {
                const motorSpeedText = data.motor_speed !== undefined ? `${data.motor_speed}%` : "100%";
                motorEl.textContent = motor === "FEEDING" ? "ทำงาน" : (motor === "ERROR" ? "ขัดข้อง" : motorSpeedText);
                motorEl.className = motor === "FEEDING" ? "status-value-text blue" : (motor === "ERROR" ? "status-value-text red" : "status-value-text green");
            }
        }
        
        // Sync motor speed slider with device state to prevent reset on refresh
        if (onlineStatus && data.motor_speed !== undefined) {
            if (motorSpeedSlider && document.activeElement !== motorSpeedSlider) {
                motorSpeedSlider.value = data.motor_speed;
                if (motorSpeedValueText) motorSpeedValueText.textContent = data.motor_speed;
            }
        }
        if (scaleEl) {
            if (!onlineStatus) {
                scaleEl.textContent = "เครื่องปิด";
                scaleEl.className = "status-value-text gray";
            } else {
                scaleEl.textContent = scaleStat === "NORMAL" ? "ปกติ" : "ขัดข้อง";
                scaleEl.className = scaleStat === "NORMAL" ? "status-value-text green" : "status-value-text red";
            }
        }
        
        // Disable controls if offline
        if (modeToggle) modeToggle.disabled = !onlineStatus;
        if (feedBtn) feedBtn.disabled = !onlineStatus || (modeToggle && !modeToggle.checked);
        if (feedAmount) feedAmount.disabled = !onlineStatus || (modeToggle && !modeToggle.checked);
        if (stopBtn) stopBtn.disabled = !onlineStatus;
        
        if (!onlineStatus) {
            labelAuto?.classList.remove("active");
            labelManual?.classList.remove("active");
        } else {
            const isManual = modeToggle ? modeToggle.checked : (mode === "MANUAL");
            updateModeUI(isManual, onlineStatus);
        }

        if (!onlineStatus) {
            document.body.classList.add("offline-mode");
        } else {
            document.body.classList.remove("offline-mode");
        }
    }

    // --- โหมด Auto/Manual สลับปุ่มให้อาหาร ---
    const labelAuto = document.getElementById("label-auto");
    const labelManual = document.getElementById("label-manual");

    function updateModeUI(isManual, onlineStatus = true) {
        if (!onlineStatus) return; // Prevent overwriting if offline
        
        if (isManual) {
            labelManual?.classList.add("active");
            labelAuto?.classList.remove("active");
            if (feedBtn) feedBtn.disabled = false;
            if (feedAmount) feedAmount.disabled = false;
        } else {
            labelAuto?.classList.add("active");
            labelManual?.classList.remove("active");
            if (feedBtn) feedBtn.disabled = true;
            if (feedAmount) feedAmount.disabled = true;
        }
    }

    if (modeToggle) {
        modeToggle.addEventListener("change", async (e) => {
            const isManual = e.target.checked;
            
            // Set debouncing flag
            isModeUpdating = true;
            updateModeUI(isManual);
            
            const modeEl = document.getElementById("statusCurrentMode");
            if (modeEl) {
                modeEl.textContent = isManual ? "Manual" : "Auto";
                modeEl.className = isManual ? "status-value-text warning" : "status-value-text green";
            }
            
            if (window.isLocalMode) {
                try {
                    const response = await fetch(`/api/set-mode?manual=${isManual ? '1' : '0'}`);
                    const result = await response.json();
                    if (result.success) {
                        alert("✅ เปลี่ยนโหมด (Local) สำเร็จ");
                    } else {
                        modeToggle.checked = !isManual; // Revert
                        updateModeUI(!isManual);
                    }
                } catch (err) {
                    modeToggle.checked = !isManual; // Revert
                    updateModeUI(!isManual);
                    alert("❌ เปลี่ยนโหมดไม่สำเร็จ (Local)");
                }
            } else {
                if (!window.isLocalMode && typeof mqtt !== 'undefined') {
                    if (mqttClient && mqttClient.connected) {
                        mqttClient.publish(TOPIC_CMD, JSON.stringify({ action: "SET_MODE", mode: isManual ? "MANUAL" : "AUTO" }));
                        alert(`✅ เปลี่ยนเป็นโหมด ${isManual ? 'MANUAL' : 'AUTO'} แล้ว`);
                    } else {
                        modeToggle.checked = !isManual;
                        updateModeUI(!isManual);
                        alert("❌ ไม่สามารถเปลี่ยนโหมดได้ (MQTT ไม่เชื่อมต่อ)");
                    }
                }
            }
            
            // Clear debouncing flag after 3 seconds (allows ESP32 enough time to sync the new status)
            setTimeout(() => {
                isModeUpdating = false;
            }, 3000);
        });
    }

    // --- เริ่มต้นระบบตามโหมด ---
    if (!window.isLocalMode && typeof mqtt !== 'undefined') {
        // [ONLINE MODE] ใช้ MQTT
        if (tankWeightText) {
            updateDashboardUI(0, false);
        }
        console.log("🌐 กำลังเชื่อมต่อ Online Mode (HiveMQ)...");
        mqttClient = mqtt.connect(MQTT_BROKER, MQTT_OPTIONS);

        mqttClient.on('connect', () => {
            console.log("✅ เชื่อมต่อ HiveMQ สำเร็จ");
            mqttClient.subscribe(TOPIC_STATUS);
            mqttClient.subscribe(TOPIC_SCHEDULE);
            mqttClient.subscribe(TOPIC_HISTORY);
            if (connStatus) {
                connStatus.className = "status-badge online";
                connStatus.innerText = "● Online";
            }
        });

        mqttClient.on('message', (topic, message) => {
            if (topic === TOPIC_STATUS) {
                try {
                    const data = JSON.parse(message.toString());
                    updateDashboardUI(data, true);
                } catch (e) {
                    console.error("❌ แปลงข้อมูล MQTT ล้มเหลว", e);
                }
            } else if (topic === TOPIC_SCHEDULE) {
                try {
                    const data = JSON.parse(message.toString());
                    let payloadSchedules = [];
                    // รองรับข้อมูลที่ตอบกลับมาเป็น { schedules: [...] } หรือ [...] โดยตรง
                    if (data && data.schedules && Array.isArray(data.schedules)) {
                        payloadSchedules = data.schedules;
                    } else if (Array.isArray(data)) {
                        payloadSchedules = data;
                    }
                    
                    const scheduleEvent = new CustomEvent('scheduleUpdatedUI', { detail: payloadSchedules });
                    window.dispatchEvent(scheduleEvent);
                } catch (e) {
                    console.error("❌ แปลงข้อมูล Schedule MQTT ล้มเหลว", e);
                }
            } else if (topic === TOPIC_HISTORY) {
                try {
                    const data = JSON.parse(message.toString());
                    let payloadHistory = [];
                    if (Array.isArray(data)) {
                        payloadHistory = data;
                        
                        // SYNC TO VERCEL POSTGRES (Frontend Sync)
                        const currentHistoryJson = JSON.stringify(payloadHistory);
                        if (!window.isLocalMode && payloadHistory.length > 0 && currentHistoryJson !== lastSyncedHistoryJson) {
                            lastSyncedHistoryJson = currentHistoryJson;
                            (async () => {
                                try {
                                    const res = await fetch("/api/history", {
                                        headers: { "x-device-id": DEVICE_ID, "x-device-code": "1234" }
                                    });
                                    if (res.ok) {
                                        const dbHistory = await res.json();
                                        let synced = false;
                                        for(let item of payloadHistory) {
                                            // Check using raw_ts directly matching ESP32's exact timestamp string
                                            let exists = dbHistory.some(dbItem => dbItem.raw_ts === item.timestamp);
                                            if(!exists) {
                                                console.log("Syncing missing history to DB:", item);
                                                await fetch('/api/history', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json', 'x-device-id': DEVICE_ID },
                                                    body: JSON.stringify({ amount: item.amount, mode: item.mode, timestamp: item.timestamp })
                                                });
                                                synced = true;
                                            }
                                        }
                                        if (synced && typeof window.loadHistory === 'function') {
                                            setTimeout(() => window.loadHistory(), 1000);
                                        }
                                    }
                                } catch(err) {
                                    console.error("Sync history failed", err);
                                }
                            })();
                        }
                    }
                    const historyEvent = new CustomEvent('historyUpdatedUI', { detail: payloadHistory });
                    window.dispatchEvent(historyEvent);
                } catch (e) { console.error("❌ แปลง History MQTT ล้มเหลว", e); } }
        });

        mqttClient.on('error', (err) => {
            console.error("❌ MQTT Error:", err);
        });

        mqttClient.on('offline', () => {
            updateDashboardUI(0, false);
        });

    } else {
        // [LOCAL MODE] ใช้ HTTP Fetch
        console.log("🏠 กำลังใช้งาน Local Mode...");
        let lastScheduleCount = -1;

        // ฟังก์ชันซิงค์เวลาจากเบราว์เซอร์ไปยัง RTC อัตโนมัติ (เฉพาะตอนเปิดหน้าเว็บครั้งแรก)
        async function syncTime() {
            try {
                const now = new Date();
                const timeData = {
                    year: now.getFullYear(),
                    month: now.getMonth() + 1,
                    day: now.getDate(),
                    hour: now.getHours(),
                    minute: now.getMinutes(),
                    second: now.getSeconds()
                };
                
                await fetch('/api/set-time', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(timeData)
                });
                console.log("✅ ส่งเวลาจากเบราว์เซอร์ไปซิงค์กับ RTC แล้ว");
            } catch (err) {
                console.warn("⚠️ ส่งเวลาไปซิงค์ไม่สำเร็จ");
            }
        }
        syncTime();

        async function fetchRealtimeWeight() {
            try {
                const response = await fetch("/api/status");
                if (!response.ok) throw new Error("ดึงข้อมูลไม่สำเร็จ");
                const data = await response.json();
                updateDashboardUI(data, true);

                // ถ้า schedule_count เปลี่ยน (Online สั่งเปลี่ยน) ให้โหลด schedule ใหม่
                if (data.schedule_count !== undefined && data.schedule_count !== lastScheduleCount) {
                    lastScheduleCount = data.schedule_count;
                    const scheduleEvent = new CustomEvent('scheduleUpdated');
                    window.dispatchEvent(scheduleEvent);
                }
            } catch (err) {
                console.warn("⚡ กำลังเชื่อมต่อกับบอร์ด ESP32...");
                updateDashboardUI(0, false);
            }
        }
        fetchRealtimeWeight();
        localFetchTimer = setInterval(fetchRealtimeWeight, 3000);
    }

    // --- 3. ฟังก์ชันปุ่มสั่งให้อาหาร ---
    if (feedBtn) {
        feedBtn.addEventListener("click", async () => {
            const amount = Number(feedAmount?.value || 10);
            if (amount <= 0) {
                alert("กรุณาระบุปริมาณอาหารมากกว่า 0 กรัม");
                return;
            }

            const originalText = feedBtn.textContent;
            feedBtn.disabled = true;
            feedBtn.textContent = "⏳ กำลังปล่อยอาหาร...";

            try {
                if (!window.isLocalMode && mqttClient && mqttClient.connected) {
                    // ส่งคำสั่งผ่าน MQTT (Online)
                    const cmdPayload = JSON.stringify({ action: "FEED", amount: amount });
                    mqttClient.publish(TOPIC_CMD, cmdPayload);

                    // (การบันทึกประวัติจะถูกจัดการโดย Frontend Sync อัตโนมัติเมื่อ ESP32 ทำงานเสร็จและส่ง MQTT กลับมา)

                    alert(`✅ ส่งคำสั่งให้อาหาร ${amount} กรัมผ่านระบบออนไลน์แล้ว`);
                } else {
                    // ส่งคำสั่งผ่าน HTTP (Local)
                    const response = await fetch(`/local-feed?amount=${amount}`);
                    const result = await response.json();
                    alert(response.ok ? `✅ ${result.message}` : "❌ สั่งให้อาหารไม่สำเร็จ");
                }
            } catch (err) {
                alert("❌ ไม่สามารถส่งคำสั่งได้");
            } finally {
                feedBtn.disabled = !(modeToggle && modeToggle.checked);
                feedBtn.textContent = originalText;
            }
        });
    }

    // --- 4. ฟังก์ชันปุ่มหยุดฉุกเฉิน ---
    if (stopBtn) {
        stopBtn.addEventListener("click", async () => {
            try {
                if (!window.isLocalMode && mqttClient && mqttClient.connected) {
                    // ส่งคำสั่งผ่าน MQTT (Online)
                    const cmdPayload = JSON.stringify({ action: "EMERGENCY_STOP" });
                    mqttClient.publish(TOPIC_CMD, cmdPayload);
                    alert("🛑 ส่งคำสั่งหยุดฉุกเฉินผ่านระบบออนไลน์แล้ว");
                } else {
                    // ส่งคำสั่งผ่าน HTTP (Local)
                    const response = await fetch("/local-stop");
                    const result = await response.json();
                    alert(`🛑 ${result.message}`);
                }
            } catch (err) {
                alert("❌ สั่งหยุดฉุกเฉินไม่สำเร็จ");
            }
        });
    }

    // --- 5. อัปเดตเวลาให้อาหาร (Dashboard) ---
    function updateDashboardLastFeed(history) {
        const lastFeedTimeEl = document.getElementById("lastFeedTime");
        if (!lastFeedTimeEl) return;
        if (history && history.length > 0) {
            const lastFeedDate = new Date(history[0].timestamp);
            lastFeedTimeEl.textContent = lastFeedDate.toLocaleTimeString("th-TH", { hour: '2-digit', minute: '2-digit' }) + " น.";
        } else {
            lastFeedTimeEl.textContent = "--:-- น.";
        }
    }

    function updateDashboardNextFeed(schedules) {
        const nextFeedTimeEl = document.getElementById("nextFeedTime");
        if (!nextFeedTimeEl) return;
        
        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        
        let nextTimeStr = null;
        let minDiff = Infinity;

        for (let s of schedules) {
            if (s.enable && s.time) {
                const [h, m] = s.time.split(":");
                const schedMinutes = parseInt(h) * 60 + parseInt(m);
                
                let diff = schedMinutes - currentMinutes;
                if (diff <= 0) {
                    diff += 24 * 60; // วันพรุ่งนี้
                }
                
                if (diff < minDiff) {
                    minDiff = diff;
                    nextTimeStr = s.time;
                }
            }
        }
        
        if (nextTimeStr) {
            nextFeedTimeEl.textContent = nextTimeStr + " น.";
        } else {
            nextFeedTimeEl.textContent = "ปิด (Off)";
        }
    }

    async function loadDashboardTimes() {
        try {
            // ดึงเวลาให้อาหารล่าสุด
            const historyRes = await fetch("/api/history", {
                headers: { "x-device-id": DEVICE_ID, "x-device-code": "1234" }
            });
            if (historyRes.ok) {
                updateDashboardLastFeed(await historyRes.json());
            }

            // ดึงเวลาที่จะให้อาหารอัตโนมัติครั้งถัดไป
            const scheduleRes = await fetch("/api/schedule", {
                headers: { "x-device-id": DEVICE_ID, "x-device-code": "1234" }
            });
            if (scheduleRes.ok) {
                updateDashboardNextFeed(await scheduleRes.json());
            }
        } catch (err) {
            console.warn("โหลดเวลา Dashboard ไม่สำเร็จ", err);
        }
    }

    window.addEventListener('scheduleUpdatedUI', (e) => {
        if (e.detail && Array.isArray(e.detail)) {
            updateDashboardNextFeed(e.detail);
        }
    });

    window.addEventListener('historyUpdatedUI', (e) => {
        if (e.detail && Array.isArray(e.detail)) {
            updateDashboardLastFeed(e.detail);
        }
    });

    // เรียกตอนโหลดหน้าจอ
    loadDashboardTimes();

    // --- 6. ควบคุมไฟ LED Status บน UI ---
    const ledPower = document.getElementById("ledPower");
    const ledLocal = document.getElementById("ledAp");
    const ledOnline = document.getElementById("ledMqtt");

    function updateUiLeds() {
        if (!currentDeviceOnline) {
            // เครื่องปิดอยู่: ไฟทุกสีจะดับ
            if (ledPower) ledPower.classList.remove("active");
            if (ledLocal) ledLocal.classList.remove("active");
            if (ledOnline) ledOnline.classList.remove("active");
        } else {
            // เสียบปลั๊ก: ไฟสีแดงติด
            if (ledPower) ledPower.classList.add("active");
            
            if (window.isLocalMode) {
                // บอร์ดปล่อยไวไฟ: ไฟสีเหลืองติด (Local)
                if (ledLocal) ledLocal.classList.add("active");
                if (ledOnline) ledOnline.classList.remove("active");
            } else {
                // บอร์ดเชื่อมไวไฟ: ไฟสีเขียวติด (Online)
                if (ledLocal) ledLocal.classList.remove("active");
                if (ledOnline) ledOnline.classList.add("active");
            }
        }
    }
    
    // เรียกตอนเริ่ม และเซ็ตให้เรียกซ้ำ
    updateUiLeds();
    setInterval(updateUiLeds, 2000);
});
// =====================================
// AP WIFI SETTINGS LOGIC (settings.html)
// =====================================
document.addEventListener("DOMContentLoaded", () => {
    const saveApBtn = document.getElementById("saveApBtn");
    const resetApBtn = document.getElementById("resetApBtn");
    const apSsidInput = document.getElementById("apSsidInput");
    const apPasswordInput = document.getElementById("apPasswordInput");
    
    // (Device ID is hardcoded to Prototype_01, no save button logic needed)

    // 1. กดปุ่มบันทึกชื่อ/รหัสผ่าน Wi-Fi ของตัวเครื่อง (AP Mode)
    if (saveApBtn) {
        saveApBtn.addEventListener("click", async () => {
            const apSsid = apSsidInput?.value.trim() || "";
            const apPass = apPasswordInput?.value.trim() || "";

            if (!apSsid) {
                alert("กรุณากรอกชื่อ WiFi ของเครื่อง");
                return;
            }

            saveApBtn.disabled = true;
            saveApBtn.textContent = "⏳ กำลังบันทึก...";

            try {
                if (window.isLocalMode) {
                    const response = await fetch(`/api/save-ap?apSsid=${encodeURIComponent(apSsid)}&apPass=${encodeURIComponent(apPass)}`, { method: "POST" });
                    const resData = await response.json();
                    if (resData.success) {
                        alert("✅ " + resData.message);
                    } else {
                        alert("❌ บันทึกไม่สำเร็จ");
                    }
                } else {
                    if (mqttClient && mqttClient.connected) {
                        mqttClient.publish(TOPIC_CMD, JSON.stringify({ action: "SET_AP_WIFI", apSsid: apSsid, apPass: apPass }));
                        alert("✅ ส่งคำสั่งบันทึก AP WiFi เรียบร้อย (เครื่องกำลังรีบูต)");
                    } else {
                        throw new Error("MQTT_BLOCKED");
                    }
                }
            } catch (err) {
                if (err.message === "MQTT_BLOCKED") {
                    alert("❌ ไม่สามารถโหลดระบบเชื่อมต่อได้ (กรุณาปิด Adblocker แล้วรีเฟรช)");
                } else {
                    alert("❌ ติดต่อ ESP32 ไม่ได้!");
                }
            } finally {
                saveApBtn.disabled = false;
                saveApBtn.textContent = "บันทึกชื่อ/รหัสผ่านเครื่อง";
            }
        });
    }

    // 2. กดปุ่มรีเซ็ตค่าเริ่มต้นของเครื่อง
    if (resetApBtn) {
        resetApBtn.addEventListener("click", async () => {
            if (!confirm("คุณต้องการรีเซ็ตค่าเริ่มต้นของเครื่องใช่หรือไม่?")) return;

            try {
                if (window.isLocalMode) {
                    const response = await fetch("/api/reset-wifi", { method: "POST" });
                    const resData = await response.json();
                    if (resData.success) {
                        alert("✅ ล้างค่าเรียบร้อย ESP32 กำลังรีบูต");
                    }
                } else {
                    if (mqttClient && mqttClient.connected) {
                        mqttClient.publish(TOPIC_CMD, JSON.stringify({ action: "RESET_WIFI" }));
                        alert("✅ ส่งคำสั่งรีเซ็ต WiFi เรียบร้อย (เครื่องกำลังรีบูต)");
                    } else {
                        throw new Error("MQTT_BLOCKED");
                    }
                }
            } catch (err) {
                if (err.message === "MQTT_BLOCKED") {
                    alert("❌ ไม่สามารถโหลดระบบเชื่อมต่อได้ (กรุณาปิด Adblocker แล้วรีเฟรช)");
                } else {
                    alert("❌ ส่งคำสั่งรีเซ็ตไม่สำเร็จ");
                }
            }
        });
    }
});

// =====================================
// SIDEBAR (HAMBURGER MENU) LOGIC
// =====================================
document.addEventListener("DOMContentLoaded", () => {
    const hamburgerBtn = document.getElementById("hamburgerBtn");
    const closeSidebarBtn = document.getElementById("closeSidebarBtn");
    const sidebarDrawer = document.getElementById("sidebarDrawer");
    const sidebarOverlay = document.getElementById("sidebarOverlay");

    if (hamburgerBtn && sidebarDrawer && sidebarOverlay) {
        const closeMenu = () => {
            sidebarDrawer.classList.remove("active");
            sidebarOverlay.classList.remove("active");
        };

        hamburgerBtn.addEventListener("click", () => {
            sidebarDrawer.classList.add("active");
            sidebarOverlay.classList.add("active");
        });

        if (closeSidebarBtn) closeSidebarBtn.addEventListener("click", closeMenu);
        sidebarOverlay.addEventListener("click", closeMenu);
    }
});

// =====================================
// TAB NAVIGATION SWITCH LOGIC (settings.html)
// =====================================
document.addEventListener("DOMContentLoaded", () => {
    const tabApBtn = document.getElementById("tabApBtn");
    const tabHomeBtn = document.getElementById("tabHomeBtn");
    const sectionAp = document.getElementById("section-ap-settings");
    const sectionHome = document.getElementById("section-home-settings");

    if (tabApBtn && tabHomeBtn) {
        tabApBtn.addEventListener("click", () => {
            tabApBtn.classList.add("active");
            tabHomeBtn.classList.remove("active");

            if (sectionAp) sectionAp.style.display = "block";
            if (sectionHome) sectionHome.style.display = "none";
        });

        tabHomeBtn.addEventListener("click", () => {
            tabHomeBtn.classList.add("active");
            tabApBtn.classList.remove("active");

            if (sectionAp) sectionAp.style.display = "none";
            if (sectionHome) sectionHome.style.display = "block";
        });
    }
});

// =====================================
// HOME WIFI SETTINGS LOGIC (settings.html)
// =====================================
document.addEventListener("DOMContentLoaded", () => {
    const connectWifiBtn = document.getElementById("connectWifiBtn");
    const forgetWifiBtn = document.getElementById("forgetWifiBtn");
    const homeSsidInput = document.getElementById("homeSsidInput");
    const homePasswordInput = document.getElementById("homePasswordInput");

    // 2. กดปุ่ม บันทึก / เชื่อมต่อ
    if (connectWifiBtn) {
        connectWifiBtn.addEventListener("click", async () => {
            const ssid = homeSsidInput?.value.trim();
            const pass = homePasswordInput?.value.trim() || "";

            if (!ssid) {
                alert("กรุณาเลือกหรือกรอกชื่อ SSID Wi-Fi บ้าน");
                return;
            }

            connectWifiBtn.disabled = true;
            connectWifiBtn.textContent = "⏳ กำลังบันทึก...";

            try {
                if (window.isLocalMode) {
                    const response = await fetch(`/api/save-wifi?ssid=${encodeURIComponent(ssid)}&pass=${encodeURIComponent(pass)}`, { method: "POST" });
                    const resData = await response.json();
                    if (resData.success) {
                        alert("✅ " + resData.message);
                    } else {
                        alert("❌ " + (resData.message || "บันทึกไม่สำเร็จ"));
                    }
                } else {
                    if (mqttClient && mqttClient.connected) {
                        mqttClient.publish(TOPIC_CMD, JSON.stringify({ action: "SET_HOME_WIFI", ssid: ssid, pass: pass }));
                        alert("✅ ส่งคำสั่งตั้งค่า WiFi บ้านเรียบร้อย (เครื่องกำลังรีบูต)");
                    } else {
                        throw new Error("MQTT_BLOCKED");
                    }
                }
            } catch (err) {
                if (err.message === "MQTT_BLOCKED") {
                    alert("❌ ไม่สามารถโหลดระบบเชื่อมต่อได้ (กรุณาปิด Adblocker แล้วรีเฟรช)");
                } else {
                    alert("❌ ติดต่อบอร์ดไม่ได้!");
                }
            } finally {
                connectWifiBtn.disabled = false;
                connectWifiBtn.textContent = "บันทึก / เชื่อมต่อ";
            }
        });
    }

    // 3. ลืมเครือข่ายนี้ (Reset WiFi)
    if (forgetWifiBtn) {
        forgetWifiBtn.addEventListener("click", async () => {
            if (!confirm("คุณต้องการลืมเครือข่ายและรีเซ็ตค่า Wi-Fi ใช่หรือไม่?")) return;
            try {
                if (window.isLocalMode) {
                    const response = await fetch("/api/reset-wifi", { method: "POST" });
                    const resData = await response.json();
                    if (resData.success) {
                        alert("✅ ลืมเครือข่ายเรียบร้อย ESP32 กำลังรีบูต");
                    }
                } else {
                    if (mqttClient && mqttClient.connected) {
                        mqttClient.publish(TOPIC_CMD, JSON.stringify({ action: "RESET_WIFI" }));
                        alert("✅ ส่งคำสั่งลืมเครือข่าย WiFi เรียบร้อย (เครื่องกำลังรีบูต)");
                    } else {
                        throw new Error("MQTT_BLOCKED");
                    }
                }
            } catch (err) {
                if (err.message === "MQTT_BLOCKED") {
                    alert("❌ ไม่สามารถโหลดระบบเชื่อมต่อได้ (กรุณาปิด Adblocker แล้วรีเฟรช)");
                } else {
                    alert("❌ ลืมเครือข่ายไม่สำเร็จ");
                }
            }
        });
    }
});
// =====================================
// SCHEDULE LOGIC (schedule.html)
// =====================================
document.addEventListener("DOMContentLoaded", () => {
    const scheduleContainer = document.getElementById("scheduleContainer");
    if (!scheduleContainer) return; // ไม่ใช่หน้า schedule.html

    const addScheduleBtn = document.getElementById("addScheduleBtn");
    const saveScheduleBtn = document.getElementById("saveScheduleBtn");
    const scheduleCountBadge = document.getElementById("scheduleCountBadge");
    
    let schedules = [];
    let isEditing = false;
    const MAX_SCHEDULES = 4;

    // ฟังก์ชันสร้างแถว UI
    function renderSchedules() {
        scheduleContainer.innerHTML = "";
        
        if (schedules.length === 0) {
            scheduleContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">ยังไม่มีการตั้งเวลา</div>`;
        }

        schedules.forEach((item, index) => {
            const row = document.createElement("div");
            row.className = "setting-row";
            row.style.position = "relative";
            row.style.padding = "16px";
            row.style.marginBottom = "12px";
            row.style.border = "1px solid var(--border-color)";
            row.style.borderRadius = "14px";
            row.style.background = "#f8fafc";
            row.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <div class="setting-icon-box bg-blue-light" style="width: 32px; height: 32px; font-size: 14px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg></div>
                        <div style="font-size: 14px; font-weight: 700; color: var(--text-main);">รอบที่ ${index + 1}</div>
                    </div>
                    <div style="display: flex; gap: 12px; align-items: center;">
                        <label class="toggle-switch-labeled" style="margin:0;">
                            <input type="checkbox" class="enable-toggle" data-index="${index}" ${item.enable ? "checked" : ""}>
                            <div class="toggle-ui" style="background:${item.enable ? 'var(--primary-color)' : '#ccc'};">
                                <div class="toggle-knob" style="left:${item.enable ? '26px' : '2px'};"></div>
                            </div>
                        </label>
                        <button class="btn-icon-sm btn-delete-schedule" data-index="${index}" style="color: #ef4444; background: #fee2e2; border-radius: 8px; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border: none; cursor: pointer;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        </button>
                    </div>
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div class="input-modern-wrapper" style="margin: 0; height: 44px; border-radius: 10px; border: 1px solid #cbd5e1; background: #fff; display: flex; overflow: hidden;">
                        <div style="padding: 0 10px; color: var(--text-muted); display:flex; align-items:center; background: #f1f5f9; border-right: 1px solid #cbd5e1; font-size:12px; font-weight: 600;">เวลา</div>
                        <select class="time-hour-input" data-index="${index}" style="border:none; outline:none; background:transparent; padding:0 4px; font-weight:700; font-size:14px; color:var(--text-main); flex:1; text-align:center; appearance:none; text-align-last:center;">
                            ${Array.from({length:24}, (_,i) => `<option value="${i.toString().padStart(2,'0')}" ${item.time.split(':')[0] === i.toString().padStart(2,'0') ? 'selected' : ''}>${i.toString().padStart(2,'0')}</option>`).join('')}
                        </select>
                        <span style="font-weight:700; display:flex; align-items:center; color: var(--text-muted);">:</span>
                        <select class="time-minute-input" data-index="${index}" style="border:none; outline:none; background:transparent; padding:0 4px; font-weight:700; font-size:14px; color:var(--text-main); flex:1; text-align:center; appearance:none; text-align-last:center;">
                            ${Array.from({length:60}, (_,i) => `<option value="${i.toString().padStart(2,'0')}" ${item.time.split(':')[1] === i.toString().padStart(2,'0') ? 'selected' : ''}>${i.toString().padStart(2,'0')}</option>`).join('')}
                        </select>
                    </div>
                    <div class="input-modern-wrapper" style="margin: 0; height: 44px; border-radius: 10px; border: 1px solid #cbd5e1; background: #fff; display: flex; overflow: hidden;">
                        <input type="number" class="amount-input" value="${item.amount || 10}" min="1" max="3000" data-index="${index}" style="flex:1; border:none; outline:none; text-align:center; padding:0 10px; font-weight:700; font-size:14px; color:var(--text-main); background:transparent;" required>
                        <span class="input-suffix" style="font-size:12px; padding:0 10px; background: #f1f5f9; border-left: 1px solid #cbd5e1; display:flex; align-items:center; font-weight:600; color:var(--text-muted);">กรัม</span>
                    </div>
                </div>
            `;
            scheduleContainer.appendChild(row);
        });

        // ผูก Event Listener ใหม่
        document.querySelectorAll(".time-hour-input").forEach(select => {
            select.addEventListener("change", (e) => {
                isEditing = true;
                const idx = e.target.dataset.index;
                const min = document.querySelector(`.time-minute-input[data-index="${idx}"]`).value;
                schedules[idx].time = `${e.target.value}:${min}`;
            });
        });

        document.querySelectorAll(".time-minute-input").forEach(select => {
            select.addEventListener("change", (e) => {
                isEditing = true;
                const idx = e.target.dataset.index;
                const hr = document.querySelector(`.time-hour-input[data-index="${idx}"]`).value;
                schedules[idx].time = `${hr}:${e.target.value}`;
            });
        });

        document.querySelectorAll(".amount-input").forEach(input => {
            input.addEventListener("change", (e) => {
                isEditing = true;
                schedules[e.target.dataset.index].amount = Number(e.target.value);
            });
        });

        document.querySelectorAll(".enable-toggle").forEach(toggle => {
            toggle.addEventListener("change", (e) => {
                isEditing = true;
                const isChecked = e.target.checked;
                schedules[e.target.dataset.index].enable = isChecked;
                
                // Update UI visually without re-rendering everything
                const label = e.target.closest('label');
                const ui = label.querySelector('.toggle-ui');
                const knob = label.querySelector('.toggle-knob');
                const text = label.querySelector('.toggle-label');
                
                if (isChecked) {
                    ui.style.background = 'var(--primary-color)';
                    knob.style.left = '26px';
                    text.style.color = 'var(--primary-color)';
                    text.textContent = 'เปิด';
                } else {
                    ui.style.background = '#ccc';
                    knob.style.left = '2px';
                    text.style.color = 'var(--text-muted)';
                    text.textContent = 'ปิด';
                }
            });
        });

        document.querySelectorAll(".btn-delete-schedule").forEach(btn => {
            btn.addEventListener("click", (e) => {
                isEditing = true;
                const index = e.currentTarget.dataset.index;
                schedules.splice(index, 1);
                renderSchedules();
            });
        });

        scheduleCountBadge.textContent = `${schedules.length}/${MAX_SCHEDULES} รอบ`;
        addScheduleBtn.disabled = schedules.length >= MAX_SCHEDULES;
    }

    // โหลดข้อมูลเริ่มต้น
    async function loadSchedules() {
        if (isEditing) return; // อย่าอัปเดตทับถ้ากำลังแก้ไขอยู่
        // Removed window.isLocalMode early return to allow API fetch in online mode too
        try {
            const response = await fetch("/api/schedule?t=" + new Date().getTime());
            if (response.ok) {
                const data = await response.json();
                // รองรับข้อมูลที่ตอบกลับมาเป็น { schedules: [...] } หรือ [...] โดยตรง
                if (data && data.schedules && Array.isArray(data.schedules)) {
                    schedules = data.schedules;
                } else if (Array.isArray(data)) {
                    schedules = data;
                } else {
                    schedules = [];
                }
                renderSchedules();
            }
        } catch (err) {
            console.warn("ไม่สามารถโหลดตารางเวลาได้");
            renderSchedules();
        }
    }

    if (addScheduleBtn) {
        addScheduleBtn.addEventListener("click", () => {
            if (schedules.length < MAX_SCHEDULES) {
                isEditing = true;
                schedules.push({ time: "08:00", amount: 10, enable: true });
                renderSchedules();
            }
        });
    }

    if (saveScheduleBtn) {
        saveScheduleBtn.addEventListener("click", async () => {
            // Validate
            for (let s of schedules) {
                if (!s.time) {
                    alert("กรุณาระบุเวลาให้ครบทุกช่อง");
                    return;
                }
            }

            saveScheduleBtn.disabled = true;
            saveScheduleBtn.textContent = "⏳ กำลังบันทึก...";

            try {
                if (window.isLocalMode) {
                    const response = await fetch("/api/schedule", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ schedules })
                    });

                    if (response.ok) {
                        alert("✅ บันทึกตารางเวลาเรียบร้อยแล้ว");
                        isEditing = false;
                    } else {
                        alert("❌ บันทึกไม่สำเร็จ");
                    }
                } else {
                    if (mqttClient && mqttClient.connected) {
                        mqttClient.publish(TOPIC_SCHEDULE, JSON.stringify(schedules), { retain: true });
                        alert("✅ บันทึกตารางเวลาผ่านระบบออนไลน์เรียบร้อยแล้ว");
                        isEditing = false;
                    } else {
                        alert("❌ ไม่สามารถติดต่อเซิร์ฟเวอร์ MQTT ได้");
                    }
                }
            } catch (err) {
                alert(`❌ เกิดข้อผิดพลาด: ${err.message}`);
            } finally {
                saveScheduleBtn.disabled = false;
                saveScheduleBtn.textContent = "บันทึกตารางเวลา";
            }
        });
    }

    window.addEventListener('scheduleUpdatedUI', (e) => {
        if (isEditing) return;
        if (e.detail && Array.isArray(e.detail)) {
            schedules = e.detail;
        }
        renderSchedules();
    });

    loadSchedules();
    if (window.isLocalMode) {
        // ฟัง event จากหน้า index เมื่อ schedule_count เปลี่ยน
        window.addEventListener('scheduleUpdated', () => {
            loadSchedules();
        });
        // poll schedule ทุก 5 วินาที ในโหมด Local เพื่อรับการเปลี่ยนแปลงจาก Online
        setInterval(loadSchedules, 5000);
    }
});

// =====================================
// HISTORY LOGIC (history.html)
// =====================================
document.addEventListener("DOMContentLoaded", () => {
    const historyTableBody = document.getElementById("historyTableBody");
    const totalFoodSummary = document.getElementById("totalFoodSummary");
    if (!historyTableBody) return; // ไม่ใช่หน้า history.html

    const clearHistoryBtn = document.getElementById("clearHistoryBtn");

    window.loadHistory = async function() {
        try {
            const response = await fetch("/api/history", {
                headers: { "x-device-id": DEVICE_ID, "x-device-code": "1234" }
            });
            if (response.ok) {
                const history = await response.json();
                renderHistory(history);
            } else {
                historyTableBody.innerHTML = `<tr><td colspan="4" style="text-align: center;">โหลดข้อมูลล้มเหลว</td></tr>`;
            }
        } catch (err) {
            historyTableBody.innerHTML = `<tr><td colspan="4" style="text-align: center;">ไม่สามารถติดต่อเซิร์ฟเวอร์ได้</td></tr>`;
        }
    }

    function renderHistory(history) {
        historyTableBody.innerHTML = "";
        let totalAmount = 0;

        if (history.length === 0) {
            historyTableBody.innerHTML = `<tr><td colspan="4" style="text-align: center;">ไม่มีประวัติการทำงาน</td></tr>`;
        } else {
            history.forEach(item => {
                totalAmount += item.amount;
                let ts = item.timestamp;
                if (typeof ts === 'string' && !ts.includes('Z') && !ts.includes('+')) {
                    ts = ts.replace(' ', 'T') + 'Z';
                }
                const date = new Date(ts);
                const dateStr = date.toLocaleDateString("th-TH", { timeZone: 'Asia/Bangkok' });
                const timeStr = date.toLocaleTimeString("th-TH", { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Bangkok' });
                const modeBadge = item.mode === 'auto' 
                    ? `<span class="status-badge green" style="padding:2px 6px;font-size:10px;">AUTO</span>`
                    : `<span class="status-badge gray" style="padding:2px 6px;font-size:10px;">MANUAL</span>`;

                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td style="padding: 10px; border-bottom: 1px solid var(--border-color);">${DEVICE_ID}</td>
                    <td style="padding: 10px; border-bottom: 1px solid var(--border-color);">${dateStr} ${timeStr}</td>
                    <td style="padding: 10px; border-bottom: 1px solid var(--border-color); font-weight: bold; color: var(--primary-color);">${item.amount} กรัม</td>
                    <td style="padding: 10px; border-bottom: 1px solid var(--border-color);">${modeBadge}</td>
                `;
                historyTableBody.appendChild(tr);
            });
        }

        if (totalFoodSummary) {
            totalFoodSummary.textContent = `${totalAmount} g`;
        }
    }

        if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener("click", async () => {
            if (!confirm("คุณต้องการล้างประวัติทั้งหมดใช่หรือไม่?")) return;

            try {
                if (window.isLocalMode) {
                    const response = await fetch("/api/history", {
                        method: "DELETE",
                        headers: { "x-device-id": DEVICE_ID, "x-device-code": "1234" }
                    });
                    if (response.ok) {
                        alert("✅ ล้างประวัติในระบบ Local เรียบร้อยแล้ว");
                        window.loadHistory();
                    }
                } else {
                    if (mqttClient && mqttClient.connected) {
                        mqttClient.publish(TOPIC_CMD, JSON.stringify({ action: "CLEAR_HISTORY" }));
                        
                        // Clear Vercel DB in Online Mode
                        await fetch("/api/history", {
                            method: "DELETE",
                            headers: { "x-device-id": DEVICE_ID, "x-device-code": "1234" }
                        });
                        lastSyncedHistoryJson = ""; // Reset sync cache
                        
                        alert("✅ ส่งคำสั่งล้างประวัติผ่านระบบออนไลน์และฐานข้อมูลเรียบร้อยแล้ว");
                        window.loadHistory();
                    } else {
                        alert("❌ ไม่สามารถเชื่อมต่อ MQTT ได้");
                    }
                }
            } catch (err) {
                alert("❌ เกิดข้อผิดพลาดในการล้างประวัติ");
            }
        });
    }

    window.addEventListener('historyUpdatedUI', (e) => {
        if (e.detail && Array.isArray(e.detail)) {
            if (window.isLocalMode) {
                renderHistory(e.detail);
            }
        }
    });

    window.loadHistory();
});

// Add missing listeners for Schedule/Weight tabs and Print Report button
document.addEventListener("DOMContentLoaded", () => {
    // History Print Button
    const printBtn = document.getElementById("printReportBtn");
    if (printBtn) {
        printBtn.addEventListener("click", () => {
            window.print();
        });
    }

    // Schedule Tabs
    const tabScheduleBtn = document.getElementById("tabScheduleBtn");
    const tabWeightBtn = document.getElementById("tabWeightBtn");
    const pageSchedule = document.getElementById("section-schedule");
    const pageWeight = document.getElementById("section-weight");

    if (tabScheduleBtn && tabWeightBtn && pageSchedule && pageWeight) {
        tabScheduleBtn.addEventListener("click", () => {
            tabScheduleBtn.classList.add("active");
            tabWeightBtn.classList.remove("active");
            pageSchedule.style.display = "block";
            pageWeight.style.display = "none";
        });
        tabWeightBtn.addEventListener("click", () => {
            tabWeightBtn.classList.add("active");
            tabScheduleBtn.classList.remove("active");
            pageWeight.style.display = "block";
            pageSchedule.style.display = "none";
        });
    }

    // Weight System (Tare & Calibration)
    const tareBtn = document.getElementById("tareBtn");
    const calibBtn = document.getElementById("calibBtn");
    const calibWeightInput = document.getElementById("calibWeightInput");

    if (tareBtn) {
        tareBtn.addEventListener("click", async () => {
            try {
                tareBtn.textContent = "⏳ กำลังปรับศูนย์...";
                tareBtn.disabled = true;
                
                if (window.isLocalMode) {
                    const response = await fetch("/local-tare");
                    const result = await response.json();
                    if (result.success) {
                        alert("✅ ปรับศูนย์ (Tare) สำเร็จ");
                    } else {
                        alert("❌ ปรับศูนย์ไม่สำเร็จ");
                    }
                } else {
                    if (mqttClient) {
                        if (!mqttClient.connected) {
                            alert("⏳ ระบบกำลังเชื่อมต่อเซิร์ฟเวอร์ คำสั่งจะถูกส่งเมื่อเชื่อมต่อสำเร็จ");
                        }
                        mqttClient.publish(TOPIC_CMD, JSON.stringify({ action: "TARE" }));
                        await new Promise(r => setTimeout(r, 1000));
                        alert("✅ ส่งคำสั่งปรับศูนย์ (Tare) แล้ว");
                    } else {
                        throw new Error("MQTT_BLOCKED");
                    }
                }
            } catch (err) {
                if (err.message === "MQTT_BLOCKED") {
                    alert("❌ ไม่สามารถโหลดระบบเชื่อมต่อได้ (กรุณาปิด Adblocker หรือ Brave Shields แล้วรีเฟรชหน้าเว็บ)");
                } else {
                    alert("❌ Error (Tare): " + err.message);
                }
            } finally {
                tareBtn.textContent = "Tare (ปรับศูนย์)";
                tareBtn.disabled = false;
            }
        });
    }

    if (calibBtn && calibWeightInput) {
        calibBtn.addEventListener("click", async () => {
            const weight = calibWeightInput.value;
            if (!weight || weight <= 0) {
                alert("กรุณาระบุน้ำหนักอ้างอิงให้ถูกต้อง");
                return;
            }
            try {
                calibBtn.textContent = "⏳ กำลังปรับเทียบ...";
                calibBtn.disabled = true;
                
                if (window.isLocalMode) {
                    const response = await fetch(`/local-calib?weight=${weight}`);
                    const result = await response.json();
                    if (result.success) {
                        alert(`✅ ปรับเทียบ (Calibration) สำเร็จ\nค่า Factor ใหม่: ${result.factor}`);
                    } else {
                        alert("❌ ปรับเทียบไม่สำเร็จ");
                    }
                } else {
                    if (mqttClient) {
                        if (!mqttClient.connected) {
                            alert("⏳ ระบบกำลังเชื่อมต่อเซิร์ฟเวอร์ คำสั่งจะถูกส่งเมื่อเชื่อมต่อสำเร็จ");
                        }
                        mqttClient.publish(TOPIC_CMD, JSON.stringify({ action: "CALIBRATE", weight: parseFloat(weight) }));
                        await new Promise(r => setTimeout(r, 1000));
                        alert("✅ ส่งคำสั่งปรับเทียบ (Calibration) แล้ว");
                    } else {
                        throw new Error("MQTT_BLOCKED");
                    }
                }
            } catch (err) {
                if (err.message === "MQTT_BLOCKED") {
                    alert("❌ ไม่สามารถโหลดระบบเชื่อมต่อได้ (กรุณาปิด Adblocker หรือ Brave Shields แล้วรีเฟรชหน้าเว็บ)");
                } else {
                    alert("❌ Error (Calib): " + err.message);
                }
            } finally {
                calibBtn.textContent = "Calibration (ปรับเทียบค่า)";
                calibBtn.disabled = false;
            }
        });
    }

    const saveCalibrationBtn = document.getElementById("saveCalibrationBtn");
    if (saveCalibrationBtn) {
        saveCalibrationBtn.addEventListener("click", () => {
            const val = document.getElementById("feedAmountInput")?.value;
            if (val && val > 0) {
                localStorage.setItem("defaultFeedAmount", val);
                alert("✅ บันทึกปริมาณอาหารเริ่มต้นเรียบร้อยแล้ว");
            }
        });
    }

    // --- Sync ปริมาณอาหารที่ใช้ต่อครั้ง ระหว่างหน้า Index และ Schedule ---
    const feedAmountInput = document.getElementById("feedAmountInput");
    const indexFeedAmount = document.getElementById("feedAmount");

    function saveFeedAmount(val) {
        if (!val || val <= 0) return;
        
        // Sync the two UI inputs immediately
        if (indexFeedAmount && indexFeedAmount.value !== val) indexFeedAmount.value = val;
        if (feedAmountInput && feedAmountInput.value !== val) feedAmountInput.value = val;
        
        // Save to local storage for persistence across reloads
        localStorage.setItem("defaultFeedAmount", val);
    }

    if (indexFeedAmount) {
        indexFeedAmount.addEventListener("input", (e) => saveFeedAmount(e.target.value));
    }
    if (feedAmountInput) {
        feedAmountInput.addEventListener("input", (e) => saveFeedAmount(e.target.value));
    }
    
    // Load feed_amount from local storage on boot
    const savedFeedAmount = localStorage.getItem("defaultFeedAmount");
    if (savedFeedAmount) {
        if (indexFeedAmount) indexFeedAmount.value = savedFeedAmount;
        if (feedAmountInput) feedAmountInput.value = savedFeedAmount;
    }
});

// --- Custom Toast Alert System ---
function showToast(message, type = "info") {
    let toastContainer = document.getElementById("toast-container");
    if (!toastContainer) {
        toastContainer = document.createElement("div");
        toastContainer.id = "toast-container";
        toastContainer.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 10px;
        `;
        document.body.appendChild(toastContainer);
    }
    
    const toast = document.createElement("div");
    
    // Parse icon from message
    let icon = "🔔";
    if (message.includes("✅")) { icon = "✅"; message = message.replace("✅", "").trim(); type = "success"; }
    else if (message.includes("❌")) { icon = "❌"; message = message.replace("❌", "").trim(); type = "error"; }
    else if (message.includes("🛑")) { icon = "🛑"; message = message.replace("🛑", "").trim(); type = "warning"; }
    
    let bg = "rgba(15, 23, 42, 0.9)";
    if (type === "success") bg = "rgba(22, 163, 74, 0.95)";
    else if (type === "error") bg = "rgba(239, 68, 68, 0.95)";
    else if (type === "warning") bg = "rgba(234, 179, 8, 0.95)";

    toast.style.cssText = `
        background: ${bg};
        color: white;
        padding: 14px 20px;
        border-radius: 12px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.2);
        font-weight: 500;
        font-size: 14px;
        display: flex;
        align-items: center;
        gap: 12px;
        backdrop-filter: blur(10px);
        transform: translateX(120%);
        transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.4s ease;
        opacity: 0;
        min-width: 250px;
    `;
    
    toast.innerHTML = `<span style="font-size: 18px;">${icon}</span> <span>${message}</span>`;
    toastContainer.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => {
        toast.style.transform = "translateX(0)";
        toast.style.opacity = "1";
    }, 10);
    
    // Auto remove
    setTimeout(() => {
        toast.style.transform = "translateX(120%)";
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 400);
    }, 3500);
}

// Override default window.alert
window.alert = function(message) {
    showToast(message);
};



    // --- ตั้งค่ามอเตอร์ (L298N) ---
    if (motorSpeedSlider && motorSpeedValueText) {
        motorSpeedSlider.addEventListener("input", (e) => {
            motorSpeedValueText.textContent = e.target.value;
        });
    }

    if (saveMotorSpeedBtn && motorSpeedSlider) {
        saveMotorSpeedBtn.addEventListener("click", () => {
            const speed = motorSpeedSlider.value;
            const prevText = saveMotorSpeedBtn.innerHTML;
            saveMotorSpeedBtn.innerHTML = "กำลังบันทึก...";
            saveMotorSpeedBtn.disabled = true;

            if (window.isLocalMode) {
                fetch("/api/set-speed?speed=" + speed)
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        alert("ตั้งค่าความเร็วมอเตอร์สำเร็จ");
                    }
                })
                .catch(e => {
                    alert("บันทึกไม่สำเร็จ (Local)");
                })
                .finally(() => {
                    saveMotorSpeedBtn.innerHTML = prevText;
                    saveMotorSpeedBtn.disabled = false;
                });
            } else {
                if (typeof mqttClient !== 'undefined' && mqttClient.connected) {
                    const payload = { action: "SET_SPEED", speed: Number(speed) };
                    mqttClient.publish(TOPIC_CMD, JSON.stringify(payload));
                    setTimeout(() => {
                        alert("ส่งคำสั่งความเร็วมอเตอร์สำเร็จ");
                        saveMotorSpeedBtn.innerHTML = prevText;
                        saveMotorSpeedBtn.disabled = false;
                    }, 500);
                } else {
                    alert("ไม่ได้เชื่อมต่อ MQTT (ระบบออฟไลน์)");
                    saveMotorSpeedBtn.innerHTML = prevText;
                    saveMotorSpeedBtn.disabled = false;
                }
            }
        });
    }
