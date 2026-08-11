// =====================================
// REAL-TIME WEIGHT & FEED CONTROL (DUAL MODE: LOCAL & ONLINE)
// =====================================
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

    const MAX_CAPACITY_GRAMS = 500; 
    const DAILY_USAGE_GRAMS = 20;   

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
    const DEVICE_ID = "device123";
    const TOPIC_STATUS = `fishfeeder/${DEVICE_ID}/status`;
    const TOPIC_CMD = `fishfeeder/${DEVICE_ID}/cmd/command`;
    
    let mqttClient = null;
    let localFetchTimer = null;

    // --- ฟังก์ชันอัปเดต UI หน้าจอ ---
    function updateDashboardUI(weight, isOnline) {
        weight = Math.max(0, parseFloat(weight || 0));

        if (connStatus) {
            if (isOnline) {
                connStatus.className = isLocalMode ? "status-badge local" : "status-badge green";
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

        if (daysRemainingText) {
            const daysLeft = (weight / DAILY_USAGE_GRAMS).toFixed(1);
            daysRemainingText.textContent = `${weight > 0 ? daysLeft : "0.0"} วัน`;
        }

        if (foodStatusBadge) {
            if (weight <= 10) {
                foodStatusBadge.textContent = "🔴 เติมอาหาร";
                foodStatusBadge.className = "status-badge red";
            } else {
                foodStatusBadge.textContent = "🟢 ปกติ";
                foodStatusBadge.className = "status-badge green";
            }
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
        modeToggle.addEventListener("change", (e) => updateModeUI(e.target.checked));
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
                connStatus.className = "status-badge green";
                connStatus.innerText = "● Online";
            }
        });

        mqttClient.on('message', (topic, message) => {
            if (topic === TOPIC_STATUS) {
                try {
                    const data = JSON.parse(message.toString());
                    updateDashboardUI(data.current_weight, true);
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
                updateDashboardUI(data.current_weight, true);
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

});
// =====================================
// AP WIFI SETTINGS LOGIC (settings.html)
// =====================================
document.addEventListener("DOMContentLoaded", () => {
    const saveApBtn = document.getElementById("saveApBtn");
    const resetApBtn = document.getElementById("resetApBtn");
    const apSsidInput = document.getElementById("apSsidInput");
    const apPasswordInput = document.getElementById("apPasswordInput");

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
                <div class="schedule-time-col">
                    <input type="time" class="time-input" value="${item.time}" data-index="${index}" required>
                </div>
                <div class="schedule-amount-col" style="display: flex; align-items: center; gap: 5px;">
                    <input type="number" class="amount-input" value="${item.amount || 10}" min="1" max="500" data-index="${index}" style="width: 60px; padding: 5px;" required>
                    <span style="font-size: 12px; color: var(--text-muted);">กรัม</span>
                </div>
                <div class="schedule-actions">
                    <label class="toggle-switch">
                        <input type="checkbox" class="enable-toggle" data-index="${index}" ${item.enable ? "checked" : ""}>
                        <span class="slider"></span>
                    </label>
                    <button class="btn-icon-sm btn-delete-schedule" data-index="${index}">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            `;
            scheduleContainer.appendChild(row);
        });

        // ผูก Event Listener ใหม่
        document.querySelectorAll(".time-input").forEach(input => {
            input.addEventListener("change", (e) => {
                schedules[e.target.dataset.index].time = e.target.value;
            });
        });

        document.querySelectorAll(".amount-input").forEach(input => {
            input.addEventListener("change", (e) => {
                schedules[e.target.dataset.index].amount = Number(e.target.value);
            });
        });

        document.querySelectorAll(".enable-toggle").forEach(toggle => {
            toggle.addEventListener("change", (e) => {
                schedules[e.target.dataset.index].enable = e.target.checked;
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
                    headers: { "Content-Type": "application/json", "x-device-id": "device123", "x-device-code": "1234" },
                    body: JSON.stringify({ schedules })
                });

                if (response.ok) {
                    alert("✅ บันทึกตารางเวลาเรียบร้อยแล้ว");
                } else {
                    alert("❌ บันทึกไม่สำเร็จ");
                }
            } catch (err) {
                alert("❌ ติดต่อเซิร์ฟเวอร์ไม่ได้");
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
                    <td style="padding: 10px; border-bottom: 1px solid var(--border-color);">${item.id || 'device123'}</td>
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
                    headers: { "x-device-id": "device123", "x-device-code": "1234" }
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
    const printBtn = document.getElementById("printBtn");
    if (printBtn) {
        printBtn.addEventListener("click", () => {
            window.print();
        });
    }

    // Schedule Tabs
    const tabScheduleBtn = document.getElementById("tabScheduleBtn");
    const tabWeightBtn = document.getElementById("tabWeightBtn");
    const pageSchedule = document.getElementById("page-schedule");
    const pageWeight = document.getElementById("page-weight");

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
});
