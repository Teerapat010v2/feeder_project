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
        saveCalibrationBtn.addEventListener("click", async () => {
            const val = document.getElementById("feedAmountInput")?.value;
            if (val && val > 0) {
                try {
                    await fetch("/api/settings/feed_amount", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ feed_amount: val })
                    });
                    alert("✅ บันทึกการตั้งค่าลงระบบเรียบร้อย");
                } catch (err) {
                    alert("❌ บันทึกไม่สำเร็จ");
                }
            } else {
                alert("✅ บันทึกการตั้งค่าลงระบบเรียบร้อย"); // Fallback
            }
        });
    }

    // --- Sync ปริมาณอาหารที่ใช้ต่อครั้ง ระหว่างหน้า Index และ Schedule ---
    const feedAmountInput = document.getElementById("feedAmountInput");
    const indexFeedAmount = document.getElementById("feedAmount");

    let feedAmountDebounceTimer = null;
    
    async function saveFeedAmount(val) {
        if (!val || val <= 0) return;
        
        // Sync the two UI inputs immediately
        if (indexFeedAmount && indexFeedAmount.value !== val) indexFeedAmount.value = val;
        if (feedAmountInput && feedAmountInput.value !== val) feedAmountInput.value = val;
        
        // Clear previous timer and setup new debounce to avoid spamming the database
        if (feedAmountDebounceTimer) clearTimeout(feedAmountDebounceTimer);
        feedAmountDebounceTimer = setTimeout(async () => {
            try {
                await fetch("/api/settings/feed_amount", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ feed_amount: val })
                });
            } catch (err) {
                console.error("Failed to save feed amount", err);
            }
        }, 1000);
    }

    if (indexFeedAmount) {
        indexFeedAmount.addEventListener("input", (e) => saveFeedAmount(e.target.value));
    }
    if (feedAmountInput) {
        feedAmountInput.addEventListener("input", (e) => saveFeedAmount(e.target.value));
    }
    
    // Load feed_amount from status on boot
    fetch("/api/status").then(res => res.json()).then(data => {
        if (data && data.feedAmount) {
            const val = data.feedAmount.toString();
            if (indexFeedAmount) indexFeedAmount.value = val;
            if (feedAmountInput) feedAmountInput.value = val;
        }
    }).catch(err => console.log("Failed to fetch initial feed_amount"));
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
