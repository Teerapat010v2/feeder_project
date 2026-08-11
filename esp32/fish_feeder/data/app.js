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