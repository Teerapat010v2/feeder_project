// =====================================
// REAL-TIME WEIGHT & FEED CONTROL (DUAL MODE: LOCAL & ONLINE)
// =====================================
const DEVICE_ID = "Prototype_01";

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

    const MAX_CAPACITY_GRAMS = 5000;
    let DAILY_USAGE_GRAMS = 20; // Default fallback

    let lastWeight = 0;

    function recalculateDaysRemaining() {
        const daysRemainingText = document.getElementById("daysRemainingText");
        const foodStatusBadge = document.getElementById("foodStatusBadge");

        let daysLeftVal = 0;
        if (daysRemainingText) {
            const daysLeft = (lastWeight / DAILY_USAGE_GRAMS);
            daysLeftVal = daysLeft;
            daysRemainingText.textContent = `${lastWeight > 0 ? daysLeft.toFixed(1) : "0.0"} วัน`;
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

    // --- ตรวจสอบว่าเป็นโหมด Online หรือ Local ---
    // ถ้ารันบน IP (192.168.x.x) ให้ใช้ Local Mode ถ้าเป็นโดเมน (vercel) ให้ใช้ Online Mode
    const isLocalMode = /^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(window.location.hostname);
    
    // --- ตั้งค่า HiveMQ (สำหรับ Online Mode) ---
    const MQTT_BROKER = "wss://97a545ab69f44dde939442a2b857bc3b.s1.eu.hivemq.cloud:8884/mqtt";
    const MQTT_OPTIONS = {
        username: "teerapat",
        password: "Teerapat99",
        clientId: "dashboard_" + Math.random().toString(16).substr(2, 8)
    };
    
    let TOPIC_STATUS = `fishfeeder/${DEVICE_ID}/status`;
    let TOPIC_CMD = `fishfeeder/${DEVICE_ID}/cmd/command`;
    
    let mqttClient = null;
    let localFetchTimer = null;
    let isModeUpdating = false;

    // --- ฟังก์ชันอัปเดต UI หน้าจอ ---
    function updateDashboardUI(data, isOnline) {
        let weight = 0;
        let mode = "MANUAL";
        let motor = "READY";
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

        if (connStatus) {
            if (onlineStatus) {
                connStatus.className = isLocalMode ? "status-badge local" : "status-badge online"; // will style .online in css
                connStatus.innerText = isLocalMode ? "● Local" : "● Online";
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
        
        if (modeEl) {
            // เราจะไม่ให้ MQTT บังคับเปลี่ยนข้อความหรือสวิตช์โหมดอีกต่อไป 
            // ปล่อยให้ LocalStorage และ Toggle Switch เป็นตัวควบคุม UI เพียงอย่างเดียว
            // แต่จะรับค่ามาตรวจสอบเฉยๆ ว่าตรงกันไหม (เผื่อใช้ debug)
        }
        if (motorEl) {
            motorEl.textContent = motor === "FEEDING" ? "ทำงาน" : (motor === "ERROR" ? "ขัดข้อง" : "พร้อม");
            motorEl.className = motor === "FEEDING" ? "status-value-text blue" : (motor === "ERROR" ? "status-value-text red" : "status-value-text green");
        }
        if (scaleEl) {
            scaleEl.textContent = scaleStat === "NORMAL" ? "ปกติ" : "ขัดข้อง";
            scaleEl.className = scaleStat === "NORMAL" ? "status-value-text green" : "status-value-text red";
        }
    }

    // --- โหมด Auto/Manual สลับปุ่มให้อาหาร ---
    const labelAuto = document.getElementById("label-auto");
    const labelManual = document.getElementById("label-manual");

    function updateModeUI(isManual) {
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
        const initialManual = localStorage.getItem("manualMode") === "true";
        modeToggle.checked = initialManual;
        
        const modeEl = document.getElementById("statusCurrentMode");
        if (modeEl) {
            modeEl.textContent = initialManual ? "Manual" : "Auto";
            modeEl.className = initialManual ? "status-value-text warning" : "status-value-text green";
        }
        
        modeToggle.addEventListener("change", (e) => {
            const isManual = e.target.checked;
            localStorage.setItem("manualMode", isManual);
            updateModeUI(isManual);
            
            if (modeEl) {
                modeEl.textContent = isManual ? "Manual" : "Auto";
                modeEl.className = isManual ? "status-value-text warning" : "status-value-text green";
            }
            
            isModeUpdating = true;
            setTimeout(() => isModeUpdating = false, 3000); // 3-second cooldown

            // Sync with ESP32 in real-time
            if (isLocalMode) {
                fetch(`/api/set-mode?manual=${isManual ? '1' : '0'}`).catch(console.error);
            } else if (mqttClient && mqttClient.connected) {
                mqttClient.publish(`fishfeeder/${DEVICE_ID}/cmd/command`, JSON.stringify({
                    action: "SET_MODE",
                    mode: isManual ? "MANUAL" : "AUTO"
                }));
            }
        });
        updateModeUI(modeToggle.checked);
    }

    // --- เริ่มต้นระบบตามโหมด ---
    if (!isLocalMode && typeof mqtt !== 'undefined') {
        // [ONLINE MODE] ใช้ MQTT
        console.log("🌐 กำลังเชื่อมต่อ Online Mode (HiveMQ)...");
        mqttClient = mqtt.connect(MQTT_BROKER, MQTT_OPTIONS);

        mqttClient.on('connect', () => {
            console.log("✅ เชื่อมต่อ HiveMQ สำเร็จ");
            mqttClient.subscribe(TOPIC_STATUS);
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
            }
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
        async function fetchRealtimeWeight() {
            try {
                const response = await fetch("/api/status");
                if (!response.ok) throw new Error("ดึงข้อมูลไม่สำเร็จ");
                const data = await response.json();
                
                updateDashboardUI(data, true);
            } catch (err) {
                console.warn("⚡ กำลังเชื่อมต่อกับบอร์ด ESP32...");
                updateDashboardUI(0, false);
            }
        }
        fetchRealtimeWeight();
        localFetchTimer = setInterval(fetchRealtimeWeight, 1500);
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
                if (!isLocalMode && mqttClient && mqttClient.connected) {
                    // ส่งคำสั่งผ่าน MQTT (Online)
                    const cmdPayload = JSON.stringify({ action: "FEED", amount: amount });
                    mqttClient.publish(TOPIC_CMD, cmdPayload);

                    // บันทึกประวัติลงฐานข้อมูล Vercel Postgres
                    try {
                        await fetch('/api/history', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ amount: amount, mode: 'manual' })
                        });
                    } catch (e) {
                        console.error('Failed to save history:', e);
                    }

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
                if (!isLocalMode && mqttClient && mqttClient.connected) {
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
    async function loadDashboardTimes() {
        const lastFeedTimeEl = document.getElementById("lastFeedTime");
        const nextFeedTimeEl = document.getElementById("nextFeedTime");
        if (!lastFeedTimeEl || !nextFeedTimeEl) return; // ไม่ใช่หน้า Dashboard

        try {
            // ดึงเวลาให้อาหารล่าสุด
            const historyRes = await fetch("/api/history", {
                headers: { "x-device-id": DEVICE_ID, "x-device-code": "1234" }
            });
            if (historyRes.ok) {
                const history = await historyRes.json();
                if (history && history.length > 0) {
                    const lastFeedDate = new Date(history[0].timestamp);
                    lastFeedTimeEl.textContent = lastFeedDate.toLocaleTimeString("th-TH", { hour: '2-digit', minute: '2-digit' }) + " น.";
                }
            }

            // ดึงเวลาที่จะให้อาหารอัตโนมัติครั้งถัดไป
            const scheduleRes = await fetch("/api/schedule", {
                headers: { "x-device-id": DEVICE_ID, "x-device-code": "1234" }
            });
            if (scheduleRes.ok) {
                const schedules = await scheduleRes.json();
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
        } catch (err) {
            console.warn("โหลดเวลา Dashboard ไม่สำเร็จ", err);
        }
    }

    // เรียกตอนโหลดหน้าจอ
    loadDashboardTimes();

    // --- 6. ควบคุมไฟ LED Status บน UI ---
    const ledPower = document.getElementById("ledPower");
    const ledLocal = document.getElementById("ledAp");
    const ledOnline = document.getElementById("ledMqtt");

    function updateUiLeds() {
        if (ledPower) ledPower.classList.add("active"); // Power always on if dashboard loaded
        
        if (isLocalMode) {
            if (ledLocal) ledLocal.classList.add("active");
            if (ledOnline) ledOnline.classList.remove("active");
        } else {
            if (ledLocal) ledLocal.classList.remove("active");
            // Online LED is controlled by MQTT connection state
            if (ledOnline) {
                if (mqttClient && mqttClient.connected) {
                    ledOnline.classList.add("active");
                } else {
                    ledOnline.classList.remove("active");
                }
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
                const response = await fetch(`/api/save-ap?apSsid=${encodeURIComponent(apSsid)}&apPass=${encodeURIComponent(apPass)}`, {
                    method: "POST"
                });
                const resData = await response.json();

                if (resData.success) {
                    alert("✅ " + resData.message);
                } else {
                    alert("❌ บันทึกไม่สำเร็จ");
                }
            } catch (err) {
                alert("❌ ติดต่อ ESP32 ไม่ได้!");
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
                const response = await fetch("/api/reset-wifi", { method: "POST" });
                const resData = await response.json();
                
                if (resData.success) {
                    alert("✅ ล้างค่าเรียบร้อย ESP32 กำลังรีบูต");
                }
            } catch (err) {
                alert("❌ ส่งคำสั่งรีเซ็ตไม่สำเร็จ");
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
                const response = await fetch(`/api/save-wifi?ssid=${encodeURIComponent(ssid)}&pass=${encodeURIComponent(pass)}`, {
                    method: "POST"
                });
                const resData = await response.json();

                if (resData.success) {
                    alert("✅ " + resData.message);
                } else {
                    alert("❌ " + (resData.message || "บันทึกไม่สำเร็จ"));
                }
            } catch (err) {
                alert("❌ ติดต่อบอร์ดไม่ได้!");
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
                const response = await fetch("/api/reset-wifi", { method: "POST" });
                const resData = await response.json();
                if (resData.success) {
                    alert("✅ ลบข้อมูล Wi-Fi เรียบร้อย ESP32 จะทำการรีบูตเข้าสู่ AP Mode");
                }
            } catch (err) {
                alert("❌ ส่งคำสั่งล้างค่าล้มเหลว!");
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
    const MAX_SCHEDULES = 4;

    // ฟังก์ชันสร้างแถว UI
    function renderSchedules() {
        scheduleContainer.innerHTML = "";
        
        if (schedules.length === 0) {
            scheduleContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">ยังไม่มีการตั้งเวลา</div>`;
        }

        schedules.forEach((item, index) => {
            const row = document.createElement("div");
            row.className = "schedule-row";
            row.innerHTML = `
                <div class="schedule-time-col" style="display:flex; align-items:center; background:#f0f2f5; padding:5px 15px; border-radius:12px; gap:5px;">
                    <select class="time-hour-input" data-index="${index}" style="appearance:none; border:none; background:transparent; font-size:24px; font-weight:bold; color:var(--primary-color); outline:none; text-align:center;">
                        ${Array.from({length:24}, (_,i) => `<option value="${i.toString().padStart(2,'0')}" ${item.time.split(':')[0] === i.toString().padStart(2,'0') ? 'selected' : ''}>${i.toString().padStart(2,'0')}</option>`).join('')}
                    </select>
                    <span style="font-size:24px; font-weight:bold; color:var(--text-color);">:</span>
                    <select class="time-minute-input" data-index="${index}" style="appearance:none; border:none; background:transparent; font-size:24px; font-weight:bold; color:var(--primary-color); outline:none; text-align:center;">
                        ${Array.from({length:60}, (_,i) => `<option value="${i.toString().padStart(2,'0')}" ${item.time.split(':')[1] === i.toString().padStart(2,'0') ? 'selected' : ''}>${i.toString().padStart(2,'0')}</option>`).join('')}
                    </select>
                    <span style="font-size:14px; margin-left:5px; color:var(--text-muted);">น.</span>
                </div>
                <div class="schedule-amount-col" style="display:flex; align-items:center; background:#f0f2f5; padding:5px 15px; border-radius:12px; gap:8px;">
                    <input type="number" class="amount-input" value="${item.amount || 10}" min="1" max="3000" data-index="${index}" style="border:none; background:transparent; font-size:18px; font-weight:bold; color:var(--primary-color); width:50px; text-align:center; outline:none;" required>
                    <span style="font-size: 14px; color: var(--text-muted);">กรัม</span>
                </div>
                <div class="schedule-actions" style="display:flex; align-items:center; gap:15px;">
                    <label class="toggle-switch-labeled" style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                        <input type="checkbox" class="enable-toggle" data-index="${index}" ${item.enable ? "checked" : ""} style="display:none;">
                        <div class="toggle-ui" style="width:50px; height:26px; border-radius:13px; background:${item.enable ? 'var(--primary-color)' : '#ccc'}; position:relative; transition:0.3s;">
                            <div class="toggle-knob" style="width:22px; height:22px; border-radius:50%; background:#fff; position:absolute; top:2px; left:${item.enable ? '26px' : '2px'}; transition:0.3s;"></div>
                        </div>
                        <span class="toggle-label" style="font-size:14px; font-weight:bold; color:${item.enable ? 'var(--primary-color)' : 'var(--text-muted)'}; min-width:30px;">${item.enable ? "เปิด" : "ปิด"}</span>
                    </label>
                    <button class="btn-icon-sm btn-delete-schedule" data-index="${index}" style="background:#ffecec; color:#ef4444; border-radius:8px; padding:8px;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            `;
            scheduleContainer.appendChild(row);
        });

        // ผูก Event Listener ใหม่
        document.querySelectorAll(".time-hour-input").forEach(select => {
            select.addEventListener("change", (e) => {
                const idx = e.target.dataset.index;
                const min = document.querySelector(`.time-minute-input[data-index="${idx}"]`).value;
                schedules[idx].time = `${e.target.value}:${min}`;
            });
        });

        document.querySelectorAll(".time-minute-input").forEach(select => {
            select.addEventListener("change", (e) => {
                const idx = e.target.dataset.index;
                const hr = document.querySelector(`.time-hour-input[data-index="${idx}"]`).value;
                schedules[idx].time = `${hr}:${e.target.value}`;
            });
        });

        document.querySelectorAll(".amount-input").forEach(input => {
            input.addEventListener("change", (e) => {
                schedules[e.target.dataset.index].amount = Number(e.target.value);
            });
        });

        document.querySelectorAll(".enable-toggle").forEach(toggle => {
            toggle.addEventListener("change", (e) => {
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
        try {
            const response = await fetch("/api/schedule");
            if (response.ok) {
                schedules = await response.json();
                renderSchedules();
            }
        } catch (err) {
            console.warn("ไม่สามารถโหลดตารางเวลาได้ (อาจต้องรอ Backend)");
            renderSchedules();
        }
    }

    if (addScheduleBtn) {
        addScheduleBtn.addEventListener("click", () => {
            if (schedules.length < MAX_SCHEDULES) {
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
                const response = await fetch("/api/schedule", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-device-id": encodeURIComponent(DEVICE_ID), "x-device-code": "1234" },
                    body: JSON.stringify({ schedules })
                });

                if (response.ok) {
                    alert("✅ บันทึกตารางเวลาเรียบร้อยแล้ว");
                } else {
                    alert("❌ บันทึกไม่สำเร็จ");
                }
            } catch (err) {
                alert(`❌ ติดต่อเซิร์ฟเวอร์ไม่ได้: ${err.message}`);
            } finally {
                saveScheduleBtn.disabled = false;
                saveScheduleBtn.textContent = "บันทึกตารางเวลา";
            }
        });
    }

    loadSchedules();
});

// =====================================
// HISTORY LOGIC (history.html)
// =====================================
document.addEventListener("DOMContentLoaded", () => {
    const historyTableBody = document.getElementById("historyTableBody");
    const totalFoodSummary = document.getElementById("totalFoodSummary");
    if (!historyTableBody) return; // ไม่ใช่หน้า history.html

    const clearHistoryBtn = document.getElementById("clearHistoryBtn");

    async function loadHistory() {
        try {
            const response = await fetch("/api/history");
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
                if (typeof ts === 'string' && !ts.includes('Z')) {
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
            if (!confirm("คุณต้องการลบประวัติทั้งหมดใช่หรือไม่?")) return;

            try {
                const response = await fetch("/api/history", {
                    method: "DELETE",
                    headers: { "x-device-id": DEVICE_ID, "x-device-code": "1234" }
                });
                if (response.ok) {
                    alert("✅ ล้างประวัติเรียบร้อย");
                    loadHistory();
                }
            } catch (err) {
                alert("❌ ล้างประวัติล้มเหลว");
            }
        });
    }

    loadHistory();
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
    const saveCalibrationBtn = document.getElementById("saveCalibrationBtn");

    if (tareBtn) {
        tareBtn.addEventListener("click", async () => {
            try {
                tareBtn.textContent = "⏳ กำลังปรับศูนย์...";
                tareBtn.disabled = true;
                
                if (isLocalMode) {
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
                
                if (isLocalMode) {
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

    if (saveCalibrationBtn) {
        saveCalibrationBtn.addEventListener("click", () => {
            alert("✅ บันทึกการตั้งค่าลงระบบเรียบร้อย");
        });
    }

    // --- Sync ปริมาณอาหารที่ใช้ต่อครั้ง ระหว่างหน้า Index และ Schedule ---
    const feedAmountInput = document.getElementById("feedAmountInput");
    const indexFeedAmount = document.getElementById("feedAmount");

    function saveFeedAmount(val) {
        if (!val || val <= 0) return;
        localStorage.setItem("sharedFeedAmount", val);
        if (indexFeedAmount && indexFeedAmount.value !== val) indexFeedAmount.value = val;
        if (feedAmountInput && feedAmountInput.value !== val) feedAmountInput.value = val;
    }

    const savedAmount = localStorage.getItem("sharedFeedAmount");
    if (savedAmount) {
        if (indexFeedAmount) indexFeedAmount.value = savedAmount;
        if (feedAmountInput) feedAmountInput.value = savedAmount;
    }

    if (indexFeedAmount) {
        indexFeedAmount.addEventListener("input", (e) => saveFeedAmount(e.target.value));
    }
    if (feedAmountInput) {
        feedAmountInput.addEventListener("input", (e) => saveFeedAmount(e.target.value));
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
