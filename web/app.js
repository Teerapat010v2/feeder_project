// =====================================
// Fish Feeder IoT Dashboard (Fixed & Safe Version)
// =====================================

// ---------- DOM Elements ----------
const statusText = document.getElementById("statusText");
const lastSeen = document.getElementById("lastSeen");

const weight = document.getElementById("weight");
const foodBar = document.getElementById("foodBar");
const foodStatusLabel = document.getElementById("foodStatusLabel");
const daysRemainingText = document.getElementById("daysRemainingText");
const dailyUsage = document.getElementById("dailyUsage");
const saveUsageBtn = document.getElementById("saveUsageBtn");

const historyTable = document.getElementById("historyTable");
const alertList = document.getElementById("alertList");
const scheduleList = document.getElementById("scheduleList");

const feedBtn = document.getElementById('feedBtn');
const stopBtn = document.getElementById("stopBtn");

const feedAmount = document.getElementById("feedAmount");

const scheduleTime = document.getElementById("scheduleTime");
const addSchedule = document.getElementById("addSchedule");

const clearHistory = document.getElementById("clearHistory");

const authModal = document.getElementById("authModal");
const authForm = document.getElementById("authForm");
const authDeviceId = document.getElementById("authDeviceId");
const authDeviceCode = document.getElementById("authDeviceCode");
const authError = document.getElementById("authError");
const logoutBtn = document.getElementById("logoutBtn");

// ---------- Dual Mode DOM ----------
const btnCloud = document.getElementById("btn-cloud") || document.getElementById("btnCloud");
const btnLocal = document.getElementById("btn-local") || document.getElementById("btnLocal");
const localIpGroup = document.getElementById("local-ip-group") || document.getElementById("localIpGroup");
const espIpInput = document.getElementById("esp-ip") || document.getElementById("espIp");

// =====================================
// DUAL MODE & LOCAL STORAGE SETTINGS
// =====================================

const AUTH_KEY = "fishfeeder_auth";
const MODE_KEY = "fishfeeder_mode";
const LOCAL_IP_KEY = "fishfeeder_local_ip";

let currentMode = localStorage.getItem(MODE_KEY) || "cloud";

function setControlMode(mode) {
    currentMode = mode;
    localStorage.setItem(MODE_KEY, mode);

    if (btnCloud && btnLocal) {
        if (mode === "cloud") {
            btnCloud.classList.add("active");
            btnLocal.classList.remove("active");
            if (localIpGroup) localIpGroup.style.display = "none";
        } else {
            btnLocal.classList.add("active");
            btnCloud.classList.remove("active");
            if (localIpGroup) localIpGroup.style.display = "block";
        }
    }
}

// โหลดค่า IP เดิมที่เคยกรอกไว้
if (espIpInput) {
    espIpInput.value = localStorage.getItem(LOCAL_IP_KEY) || "192.168.1.150";
    espIpInput.addEventListener("change", () => {
        localStorage.setItem(LOCAL_IP_KEY, espIpInput.value.trim());
    });
}

// =====================================
// DEVICE AUTH
// =====================================

function getAuth() {
    try {
        return JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
    } catch {
        return null;
    }
}

function setAuth(deviceId, deviceCode) {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ deviceId, deviceCode }));
}

function clearAuthStorage() {
    localStorage.removeItem(AUTH_KEY);
}

function authHeaders() {
    const auth = getAuth() || { deviceId: "DEV01", deviceCode: "1234" }; // ใส่ค่า Default สำรองไว้กรณีไม่ได้ล็อกอิน
    return {
        "x-device-id": auth.deviceId,
        "x-device-code": auth.deviceCode
    };
}

function showAuthModal(message) {
    if (authError) authError.textContent = message || "";
    if (authModal) authModal.style.display = "flex";
}

function hideAuthModal() {
    if (authModal) authModal.style.display = "none";
}

// =====================================
// XSS PROTECTION
// =====================================

function escapeHtml(str) {
    if (str === undefined || str === null) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// =====================================
// FOOD STATUS
// =====================================

function calculateFoodStatus(weightRemaining, dailyUsageValue) {
    if (dailyUsageValue <= 0) {
        return {
            level: "green",
            label: "ปกติ",
            daysRemaining: Infinity,
            weightRemaining
        };
    }

    const daysRemaining = weightRemaining / dailyUsageValue;

    if (daysRemaining < 3) {
        return {
            level: "red",
            label: "วิกฤต",
            daysRemaining: Number(daysRemaining.toFixed(1)),
            weightRemaining
        };
    }

    if (daysRemaining < 7) {
        return {
            level: "yellow",
            label: "เตือน",
            daysRemaining: Number(daysRemaining.toFixed(1)),
            weightRemaining
        };
    }

    return {
        level: "green",
        label: "ปกติ",
        daysRemaining: Number(daysRemaining.toFixed(1)),
        weightRemaining
    };
}

// =====================================
// API CALLS
// =====================================

async function getJSON(url) {
    const res = await fetch(url, {
        headers: { ...authHeaders() }
    });

    if (res.status === 401) {
        clearAuthStorage();
        showAuthModal("ไอดีเครื่องหรือรหัสไม่ถูกต้อง กรุณากรอกใหม่");
        throw new Error("Unauthorized");
    }

    return await res.json();
}

async function postJSON(url, data = {}) {
    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...authHeaders()
        },
        body: JSON.stringify(data)
    });

    if (res.status === 401) {
        clearAuthStorage();
        showAuthModal("ไอดีเครื่องหรือรหัสไม่ถูกต้อง กรุณากรอกใหม่");
        throw new Error("Unauthorized");
    }

    return await res.json();
}

async function deleteAPI(url) {
    const res = await fetch(url, {
        method: "DELETE",
        headers: { ...authHeaders() }
    });

    if (res.status === 401) {
        clearAuthStorage();
        showAuthModal("ไอดีเครื่องหรือรหัสไม่ถูกต้อง กรุณากรอกใหม่");
        throw new Error("Unauthorized");
    }

    return await res.json();
}

// =====================================
// LOADERS
// =====================================

async function loadStatus() {
    try {
        const data = await getJSON("/api/status");
        updateStatus(data);
    } catch (e) {
        console.warn("Could not load status:", e.message);
    }
}

async function loadHistory() {
    try {
        const history = await getJSON("/api/history");
        renderHistory(history);
    } catch (e) {
        console.warn("Could not load history:", e.message);
    }
}

async function loadAlerts() {
    try {
        const alerts = await getJSON("/api/alerts");
        renderAlerts(alerts);
    } catch (e) {
        console.warn("Could not load alerts:", e.message);
    }
}

async function loadSchedule() {
    try {
        const schedules = await getJSON("/api/schedule");
        renderSchedule(schedules);
    } catch (e) {
        console.warn("Could not load schedule:", e.message);
    }
}

// =====================================
// STATUS & PROGRESS
// =====================================

function updateStatus(data) {
    if (statusText) {
        if (data.online) {
            statusText.innerHTML = "ONLINE";
            statusText.className = "online";
        } else {
            statusText.innerHTML = "OFFLINE";
            statusText.className = "offline";
        }
    }

    if (dailyUsage && data.dailyUsage && document.activeElement !== dailyUsage) {
        dailyUsage.value = data.dailyUsage;
    }

    const currentWeight = data.weight || 0;
    const dailyUsageValue = Number(dailyUsage?.value || data.dailyUsage || 100);

    const foodStatus = data.foodStatus || calculateFoodStatus(currentWeight, dailyUsageValue);

    if (weight) weight.innerHTML = currentWeight;
    if (foodStatusLabel) {
        foodStatusLabel.innerHTML = foodStatus.label;
        foodStatusLabel.className = `fw-bold text-${foodStatus.level === 'green' ? 'success' : foodStatus.level === 'yellow' ? 'warning' : 'danger'}`;
    }
    if (daysRemainingText) {
        daysRemainingText.innerHTML = foodStatus.daysRemaining === Infinity ? "∞ วัน" : `${foodStatus.daysRemaining} วัน`;
    }

    if (lastSeen) {
        if (data.lastSeen) {
            if (data.lastSeen._seconds) {
                lastSeen.innerHTML = new Date(data.lastSeen._seconds * 1000).toLocaleString();
            } else {
                lastSeen.innerHTML = new Date(data.lastSeen).toLocaleString();
            }
        } else {
            lastSeen.innerHTML = "-";
        }
    }

    updateProgress(currentWeight);
}

function updateProgress(current) {
    if (!foodBar) return;

    const max = 3000;
    let percent = (current / max) * 100;

    if (percent > 100) percent = 100;

    foodBar.style.width = percent + "%";
    foodBar.innerHTML = Math.round(percent) + "%";

    if (percent > 60) {
        foodBar.className = "progress-bar bg-success";
    } else if (percent > 30) {
        foodBar.className = "progress-bar bg-warning";
    } else {
        foodBar.className = "progress-bar bg-danger";
    }
}

// =====================================
// RENDERERS
// =====================================

function renderHistory(history) {
    if (!historyTable) return;
    historyTable.innerHTML = "";
    if (!Array.isArray(history)) return;

    history.forEach(item => {
        const tr = document.createElement("tr");

        const date = item.timestamp
            ? new Date(
                item.timestamp._seconds
                    ? item.timestamp._seconds * 1000
                    : item.timestamp
              ).toLocaleString()
            : "-";

        tr.innerHTML = `
            <td>${escapeHtml(date)}</td>
            <td>${escapeHtml(item.amount)} g</td>
            <td>${escapeHtml(item.mode)}</td>
        `;

        historyTable.appendChild(tr);
    });
}

function renderAlerts(alerts) {
    if (!alertList) return;
    alertList.innerHTML = "";
    if (!Array.isArray(alerts)) return;

    alerts.forEach(alert => {
        const li = document.createElement("li");
        li.className = "list-group-item";
        li.innerHTML = `
            <strong>${escapeHtml((alert.level || "").toUpperCase())}</strong><br>
            ${escapeHtml(alert.message)}
        `;
        alertList.appendChild(li);
    });
}

let schedules = [];

function renderSchedule(data) {
    if (!scheduleList) return;
    schedules = Array.isArray(data) ? data : [];
    scheduleList.innerHTML = "";

    schedules.forEach(item => {
        const li = document.createElement("li");
        li.className = "list-group-item d-flex justify-content-between align-items-center";

        const timeSpan = document.createElement("span");
        timeSpan.textContent = item.time;

        const btn = document.createElement("button");
        btn.className = "btn btn-danger btn-sm";
        btn.textContent = "Delete";
        btn.addEventListener("click", () => removeSchedule(item.id));

        li.appendChild(timeSpan);
        li.appendChild(btn);

        scheduleList.appendChild(li);
    });
}

function removeSchedule(id) {
    schedules = schedules.filter(item => item.id !== id);
    saveSchedule();
}

async function saveSchedule() {
    const payload = schedules.map(item => ({
        time: item.time,
        enable: true
    }));

    const result = await postJSON("/api/schedule", {
        schedules: payload
    });

    if (result && result.success === false) {
        alert(result.message);
    }

    loadSchedule();
}

// =====================================
// APP INIT
// =====================================

let socket = null;

function startApp(auth) {
    // ตั้งค่า Mode ล่าสุดตาม Storage
    setControlMode(currentMode);

    // Socket.io Connection
    if (typeof io !== "undefined") {
        socket = io({
            auth: {
                deviceId: auth.deviceId,
                deviceCode: auth.deviceCode
            }
        });

        socket.on("connect", () => {
            console.log("Socket Connected");
        });

        socket.on("connect_error", (err) => {
            console.log("Socket connect_error:", err.message);
            clearAuthStorage();
            showAuthModal("ไอดีเครื่องหรือรหัสไม่ถูกต้อง กรุณากรอกใหม่");
        });

        socket.on("status", (data) => updateStatus(data));
        socket.on("weight", (data) => updateStatus({ online: true, weight: data.weight }));
        socket.on("history", (data) => renderHistory(data));
        socket.on("alerts", (data) => renderAlerts(data));
        socket.on("alert", () => loadAlerts());
        socket.on("schedule", (data) => renderSchedule(data));
    }

    // ---------- Event Listeners (Safe Mode) ----------

    if (btnCloud) btnCloud.addEventListener("click", () => setControlMode("cloud"));
    if (btnLocal) btnLocal.addEventListener("click", () => setControlMode("local"));

    saveUsageBtn?.addEventListener("click", async () => {
        const usage = Number(dailyUsage?.value || 0);
        if (usage <= 0) {
            alert("Daily usage must be greater than 0");
            return;
        }
        await postJSON("/api/usage", { dailyUsage: usage });
        alert("Daily usage updated");
    });

   // 🐟 สั่งให้อาหาร (รองรับ Dual Mode)
    feedBtn?.addEventListener("click", async () => {
        // ดึงค่าจำนวนกรัมที่ผู้ใช้กรอก (ถ้าไม่ได้กรอกให้ใช้ 10)
        const grams = Number(feedAmount?.value || 10);

        if (grams <= 0) {
            alert("Amount must be greater than 0");
            return;
        }

        const originalText = feedBtn.textContent;
        feedBtn.disabled = true;
        feedBtn.textContent = "⏳ กำลังส่งคำสั่ง...";

        try {
            if (currentMode === "cloud") {
                // 🟢 ใช้ postJSON แทน fetch เพื่อให้จัดการ Auth Header และ parse JSON ให้อัตโนมัติ
                const result = await postJSON('/api/feed', {
                    deviceId: "device123", // ตรงตาม secrets.h
                    amountGrams: grams     // ใช้ค่า grams ตามที่ผู้ใช้ระบุ
                });

                if (result && result.success) {
                    alert("✅ [Cloud Mode] ส่งคำสั่งให้อาหารเรียบร้อย!");
                } else {
                    alert("❌ เกิดข้อผิดพลาด: " + (result?.error || result?.message || "ส่งคำสั่งไม่สำเร็จ"));
                }
            } else {
                // 🏠 Local Mode: ยิงตรงไปหา IP ของ ESP8266 ในวง LAN
                const espIp = espIpInput ? espIpInput.value.trim() : "";
                if (!espIp) {
                    alert("กรุณากรอก IP Address ของ ESP8266");
                    return;
                }

                localStorage.setItem(LOCAL_IP_KEY, espIp);

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);

                const response = await fetch(`http://${espIp}/local-feed?amount=${grams}`, {
                    method: "GET",
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (response.ok) {
                    alert("✅ [Local Mode] สั่งให้อาหารโดยตรงสำเร็จ!");
                } else {
                    alert("❌ [Local Mode] บอร์ดตอบกลับข้อผิดพลาด");
                }
            }
        } catch (err) {
            console.error("Feed Action Error:", err);
            if (currentMode === "local") {
                alert("❌ [Local Mode] ติดต่อบอร์ดไม่ได้! ตรวจสอบว่ามือถือและบอร์ดอยู่ใน Wi-Fi เดียวกันหรือไม่");
            } else {
                alert("❌ เกิดข้อผิดพลาดในการเชื่อมต่อ Cloud API");
            }
        } finally {
            feedBtn.disabled = false;
            feedBtn.textContent = originalText;
        }
    });

    // 🛑 หยุดฉุกเฉิน (รองรับ Dual Mode)
    stopBtn?.addEventListener("click", async () => {
        try {
            if (currentMode === "cloud") {
                // 🟢 ต้องส่ง deviceId ไปให้ Backend ด้วย
                const result = await postJSON("/api/stop", { deviceId: "device123" });
                
                if (result && result.success) {
                    alert("🛑 [Cloud Mode] ส่งคำสั่งหยุดฉุกเฉินแล้ว");
                } else {
                    alert("❌ หยุดฉุกเฉินไม่สำเร็จ: " + (result?.error || ""));
                }
            } else {
                const espIp = espIpInput ? espIpInput.value.trim() : "";
                if (!espIp) {
                    alert("กรุณากรอก IP Address ของ ESP8266");
                    return;
                }
                await fetch(`http://${espIp}/local-stop`, { method: "GET" });
                alert("🛑 [Local Mode] ส่งคำสั่งหยุดฉุกเฉินแล้ว");
            }
        } catch (err) {
            console.error("Stop Action Error:", err);
            alert("❌ เกิดข้อผิดพลาดในการส่งคำสั่งหยุด");
        }
    });

    addSchedule?.addEventListener("click", () => {
        if (!scheduleTime || scheduleTime.value === "") {
            alert("Please select time");
            return;
        }

        schedules.push({
            time: scheduleTime.value,
            enable: true
        });

        saveSchedule();
        scheduleTime.value = "";
    });

    clearHistory?.addEventListener("click", async () => {
        if (confirm("Clear feeding history?")) {
            await deleteAPI("/api/history");
            loadHistory();
        }
    });

    // ---------- Initial Load ----------

    async function init() {
        await loadStatus();
        await loadHistory();
        await loadAlerts();
        await loadSchedule();
    }

    init();
}

// =====================================
// AUTH GATE
// =====================================

authForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const deviceId = authDeviceId?.value.trim();
    const deviceCode = authDeviceCode?.value.trim();

    if (!deviceId || !deviceCode) {
        if (authError) authError.textContent = "กรุณากรอกไอดีเครื่องและรหัส";
        return;
    }

    try {
        const res = await fetch("/api/verify", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-device-id": deviceId,
                "x-device-code": deviceCode
            },
            body: JSON.stringify({})
        });

        if (res.ok) {
            setAuth(deviceId, deviceCode);
            hideAuthModal();
            startApp({ deviceId, deviceCode });
        } else {
            if (authError) authError.textContent = "ไอดีเครื่องหรือรหัสไม่ถูกต้อง";
        }
    } catch (err) {
        if (authError) authError.textContent = "เชื่อมต่อ server ไม่ได้ ลองใหม่อีกครั้ง";
    }
});

logoutBtn?.addEventListener("click", () => {
    clearAuthStorage();
    if (socket) socket.disconnect();
    location.reload();
});

// ---------- Bootstrap ----------

// ---------- Bootstrap ----------

const existingAuth = getAuth();

// เพิ่มเงื่อนไข: หากไม่มี authModal ในหน้า HTML ให้เริ่มทำงาน startApp() ทันที
if (existingAuth || !authModal) {
    hideAuthModal();
    startApp(existingAuth || { deviceId: "DEV01", deviceCode: "1234" });
} else {
    showAuthModal();
}