// =====================================
// Fish Feeder IoT - Integrated App Script
// =====================================

const AUTH_KEY = "fishfeeder_auth";
const MODE_KEY = "fishfeeder_mode";
const LOCAL_IP_KEY = "fishfeeder_local_ip";
const FEED_AMOUNT_KEY = "fishfeeder_feed_amount";
const MAX_CAPACITY_GRAMS = 1000;

let currentMode = localStorage.getItem(MODE_KEY) || "cloud";
let schedules = [];
let rawHistoryData = [];
let socket = null;

// ---------- DOM Elements ----------
let elements = {};

function initDOMElements() {
    elements = {
        statusText: document.getElementById("statusText"),
        lastSeen: document.getElementById("lastSeen"),
        weight: document.getElementById("weight"),
        daysRemainingText: document.getElementById("daysRemainingText"),
        dailyUsage: document.getElementById("dailyUsage"),
        saveUsageBtn: document.getElementById("saveUsageBtn"),
        alertList: document.getElementById("alertList"),
        scheduleList: document.getElementById("scheduleList"),
        feedBtn: document.getElementById("feedBtn"),
        stopBtn: document.getElementById("stopBtn"),
        feedAmount: document.getElementById("feedAmount"),
        scheduleTime: document.getElementById("scheduleTime"),
        addSchedule: document.getElementById("addSchedule"),
        clearHistory: document.getElementById("clearHistory"),
        authModal: document.getElementById("authModal"),
        authForm: document.getElementById("authForm"),
        authDeviceId: document.getElementById("authDeviceId"),
        authDeviceCode: document.getElementById("authDeviceCode"),
        authError: document.getElementById("authError"),
        logoutBtn: document.getElementById("logoutBtn"),
        btnCloud: document.getElementById("btn-cloud") || document.getElementById("btnCloud"),
        btnLocal: document.getElementById("btn-local") || document.getElementById("btnLocal"),
        localIpGroup: document.getElementById("local-ip-group") || document.getElementById("localIpGroup"),
        espIpInput: document.getElementById("esp-ip") || document.getElementById("espIp")
    };
}

function setControlMode(mode) {
    currentMode = mode;
    localStorage.setItem(MODE_KEY, mode);

    if (elements.btnCloud && elements.btnLocal) {
        if (mode === "cloud") {
            elements.btnCloud.classList.add("active");
            elements.btnLocal.classList.remove("active");
            if (elements.localIpGroup) elements.localIpGroup.style.display = "none";
        } else {
            elements.btnLocal.classList.add("active");
            elements.btnCloud.classList.remove("active");
            if (elements.localIpGroup) elements.localIpGroup.style.display = "block";
        }
    }
    updateConnectionStatusUI();
}

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
    const auth = getAuth() || { deviceId: "device123", deviceCode: "1234" };
    return {
        "x-device-id": auth.deviceId,
        "x-device-code": auth.deviceCode
    };
}

function showAuthModal(message) {
    if (elements.authError) elements.authError.textContent = message || "";
    if (elements.authModal) elements.authModal.style.display = "flex";
}

function hideAuthModal() {
    if (elements.authModal) elements.authModal.style.display = "none";
}

function escapeHtml(str) {
    if (str === undefined || str === null) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function updateRealtimeWeightUI(realWeightGrams, dailyUsageValue = 100) {
    const currentWeight = Math.max(0, Number(realWeightGrams) || 0);
    const usage = dailyUsageValue > 0 ? dailyUsageValue : 100;
    const daysRemaining = (currentWeight / usage).toFixed(1);

    const tankWeightText = document.getElementById("tankWeightText");
    const progressBar = document.getElementById("tankProgressBar");
    const foodStatusBadge = document.getElementById("foodStatusBadge");

    if (tankWeightText) tankWeightText.innerText = `${currentWeight} g`;
    if (elements.weight) elements.weight.innerText = currentWeight;
    if (elements.daysRemainingText) elements.daysRemainingText.innerText = `${daysRemaining} วัน`;

    if (progressBar) {
        const fillPercent = Math.min((currentWeight / MAX_CAPACITY_GRAMS) * 100, 100);
        progressBar.style.width = `${fillPercent}%`;
    }

    if (foodStatusBadge) {
        if (daysRemaining < 3) {
            foodStatusBadge.className = "status-badge red";
            foodStatusBadge.innerText = "🔴 เติมอาหาร";
        } else if (daysRemaining < 7) {
            foodStatusBadge.className = "status-badge yellow";
            foodStatusBadge.innerText = "🟡 อาหารเหลือน้อย";
        } else {
            foodStatusBadge.className = "status-badge green";
            foodStatusBadge.innerText = "🟢 อาหารเพียงพอ";
        }
    }
}

function updateConnectionStatusUI(isOnline = false) {
    const connStatus = document.getElementById("connectionStatus");
    if (!connStatus) return;

    if (currentMode === "local") {
        connStatus.className = "status-badge local";
        connStatus.innerText = "● Local";
    } else if (isOnline) {
        connStatus.className = "status-badge online";
        connStatus.innerText = "● Online";
    } else {
        connStatus.className = "status-badge offline";
        connStatus.innerText = "● Offline";
    }
}

async function getJSON(url) {
    const res = await fetch(url, { headers: { ...authHeaders() } });
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
        headers: { "Content-Type": "application/json", ...authHeaders() },
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
    const res = await fetch(url, { method: "DELETE", headers: { ...authHeaders() } });
    if (res.status === 401) {
        clearAuthStorage();
        showAuthModal("ไอดีเครื่องหรือรหัสไม่ถูกต้อง กรุณากรอกใหม่");
        throw new Error("Unauthorized");
    }
    return await res.json();
}

function updateStatus(data) {
    const isOnline = data && data.online === true;
    updateConnectionStatusUI(isOnline);

    const currentWeight = data?.weight ?? data?.current_weight ?? 0;
    const usageVal = Number(data?.dailyUsage || elements.dailyUsage?.value || 100);
    updateRealtimeWeightUI(currentWeight, usageVal);
}

async function loadStatus() {
    try { updateStatus(await getJSON("/api/status")); } catch (e) { console.warn("Load status error:", e.message); }
}

async function loadHistory() {
    try { 
        const data = await getJSON("/api/history");
        processHistoryData(data); 
    } catch (e) { 
        console.warn("Load history error:", e.message); 
    }
}

async function loadAlerts() {
    try { renderAlerts(await getJSON("/api/alerts")); } catch (e) { console.warn("Load alerts error:", e.message); }
}

async function loadSchedule() {
    try { renderSchedule(await getJSON("/api/schedule")); } catch (e) { console.warn("Load schedule error:", e.message); }
}

function renderAlerts(alerts) {
    if (!elements.alertList) return;
    elements.alertList.innerHTML = "";
    if (!Array.isArray(alerts)) return;

    alerts.forEach(alert => {
        const li = document.createElement("li");
        li.className = "list-group-item";
        li.innerHTML = `<strong>${escapeHtml((alert.level || "").toUpperCase())}</strong><br>${escapeHtml(alert.message)}`;
        elements.alertList.appendChild(li);
    });
}

function renderSchedule(data) {
    if (!elements.scheduleList) return;
    schedules = Array.isArray(data) ? data : [];
    elements.scheduleList.innerHTML = "";

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
        elements.scheduleList.appendChild(li);
    });
}

function removeSchedule(id) {
    schedules = schedules.filter(item => item.id !== id);
    saveSchedule();
}

async function saveSchedule() {
    const payload = schedules.map(item => ({ time: item.time, enable: true }));
    const result = await postJSON("/api/schedule", { schedules: payload });
    if (result && result.success === false) alert(result.message);
    loadSchedule();
}

function startApp(auth) {
    setControlMode(currentMode);

    if (typeof io !== "undefined") {
        socket = io({ auth: { deviceId: auth.deviceId, deviceCode: auth.deviceCode } });
        socket.on("status", updateStatus);
        socket.on("weight", (data) => {
            const usageVal = Number(elements.dailyUsage?.value || 100);
            updateRealtimeWeightUI(data.weight, usageVal);
        });
        socket.on("history", (data) => processHistoryData(data));
        socket.on("alerts", renderAlerts);
        socket.on("schedule", renderSchedule);
    }

    elements.feedBtn?.addEventListener("click", async () => {
        const grams = Number(elements.feedAmount?.value || 10);
        if (grams <= 0) return alert("กรุณาระบุปริมาณอาหารมากกว่า 0 กรัม");

        elements.feedBtn.disabled = true;
        elements.feedBtn.textContent = "⏳ กำลังส่งคำสั่ง...";

        try {
            if (currentMode === "cloud") {
                const result = await postJSON('/api/feed', { grams: grams });
                alert(result && result.success ? "✅ [Cloud Mode] ส่งคำสั่งเรียบร้อย!" : `❌ ${result?.message || "ส่งไม่สำเร็จ"}`);
            } else {
                const espIp = elements.espIpInput ? elements.espIpInput.value.trim() : "";
                if (!espIp) return alert("กรุณากรอก IP Address ของอุปกรณ์");
                localStorage.setItem(LOCAL_IP_KEY, espIp);

                const response = await fetch(`http://${espIp}/local-feed?amount=${grams}`);
                alert(response.ok ? "✅ [Local Mode] สั่งให้อาหารสำเร็จ!" : "❌ บอร์ดตอบกลับข้อผิดพลาด");
            }
        } catch (err) {
            alert(currentMode === "local" ? "❌ ติดต่อบอร์ดไม่ได้!" : "❌ เชื่อมต่อ Cloud API ล้มเหลว");
        } finally {
            elements.feedBtn.disabled = false;
            elements.feedBtn.textContent = "ให้อาหาร";
        }
    });

    elements.stopBtn?.addEventListener("click", async () => {
        try {
            if (currentMode === "cloud") {
                const result = await postJSON("/api/stop", {});
                alert(result && result.success ? "🛑 ส่งคำสั่งหยุดแล้ว" : "❌ หยุดไม่สำเร็จ");
            } else {
                const espIp = elements.espIpInput ? elements.espIpInput.value.trim() : "";
                if (!espIp) return alert("กรุณากรอก IP Address ของอุปกรณ์");
                await fetch(`http://${espIp}/local-stop`);
                alert("🛑 [Local Mode] ส่งคำสั่งหยุดแล้ว");
            }
        } catch (err) {
            alert("❌ ส่งคำสั่งหยุดล้มเหลว");
        }
    });

    loadStatus();
    loadHistory();
    loadAlerts();
    loadSchedule();
}

function processHistoryData(historyList) {
    rawHistoryData = Array.isArray(historyList) ? historyList : [];
    filterAndRenderHistory();
}

function filterAndRenderHistory() {
    const startDateVal = document.getElementById("startDateInput")?.value;
    const endDateVal = document.getElementById("endDateInput")?.value;
    
    let filtered = [...rawHistoryData];

    if (startDateVal) {
        const start = new Date(startDateVal);
        start.setHours(0, 0, 0, 0);
        filtered = filtered.filter(item => {
            const itemDate = new Date(item.timestamp?._seconds ? item.timestamp._seconds * 1000 : item.timestamp);
            return itemDate >= start;
        });
    }

    if (endDateVal) {
        const end = new Date(endDateVal);
        end.setHours(23, 59, 59, 999);
        filtered = filtered.filter(item => {
            const itemDate = new Date(item.timestamp?._seconds ? item.timestamp._seconds * 1000 : item.timestamp);
            return itemDate <= end;
        });
    }

    const totalAmount = filtered.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    const totalSummaryText = document.getElementById("totalFoodSummary");
    if (totalSummaryText) {
        totalSummaryText.innerText = `${totalAmount.toLocaleString()} g`;
    }

    renderHistoryTable(filtered);
}

function renderHistoryTable(historyList) {
    const historyTable = document.getElementById("historyTableBody");
    if (!historyTable) return;

    historyTable.innerHTML = "";

    if (historyList.length === 0) {
        historyTable.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; padding: 20px; color: var(--text-muted);">
                    ไม่พบข้อมูลประวัติในช่วงเวลาที่เลือก
                </td>
            </tr>`;
        return;
    }

    const currentAuth = getAuth();
    const defaultDeviceId = currentAuth?.deviceId || "device123";

    historyList.forEach(item => {
        const tr = document.createElement("tr");
        tr.style.borderBottom = "1px solid var(--border-color)";

        const deviceId = escapeHtml(item.deviceId || defaultDeviceId);
        const date = item.timestamp
            ? new Date(item.timestamp._seconds ? item.timestamp._seconds * 1000 : item.timestamp).toLocaleString("th-TH")
            : "-";
        const amount = `${escapeHtml(item.amount || 0)} g`;
        const mode = item.mode === "auto" ? "อัตโนมัติ (Auto)" : "สั่งเอง (Manual)";

        tr.innerHTML = `
            <td style="padding: 10px; font-weight: 600;">${deviceId}</td>
            <td style="padding: 10px;">${escapeHtml(date)}</td>
            <td style="padding: 10px; color: var(--primary-color); font-weight: 700;">${amount}</td>
            <td style="padding: 10px;">${mode}</td>
        `;

        historyTable.appendChild(tr);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    initDOMElements();

    if (elements.espIpInput) {
        elements.espIpInput.value = localStorage.getItem(LOCAL_IP_KEY) || "192.168.1.150";
        elements.espIpInput.addEventListener("change", () => {
            localStorage.setItem(LOCAL_IP_KEY, elements.espIpInput.value.trim());
        });
    }

    elements.authForm?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const deviceId = elements.authDeviceId?.value.trim();
        const deviceCode = elements.authDeviceCode?.value.trim();
        if (!deviceId || !deviceCode) return showAuthModal("กรุณากรอกไอดีเครื่องและรหัส");

        try {
            const res = await fetch("/api/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-device-id": deviceId, "x-device-code": deviceCode },
                body: JSON.stringify({})
            });
            if (res.ok) {
                setAuth(deviceId, deviceCode);
                hideAuthModal();
                startApp({ deviceId, deviceCode });
            } else {
                showAuthModal("ไอดีเครื่องหรือรหัสไม่ถูกต้อง");
            }
        } catch {
            showAuthModal("เชื่อมต่อ server ไม่ได้");
        }
    });

    elements.logoutBtn?.addEventListener("click", () => {
        clearAuthStorage();
        if (socket) socket.disconnect();
        location.reload();
    });

    const scanWifiBtn = document.getElementById("scanWifiBtn");
    const connectWifiBtn = document.getElementById("connectWifiBtn");
    const homeSsidInput = document.getElementById("homeSsidInput");
    const homePasswordInput = document.getElementById("homePasswordInput");

    if (scanWifiBtn) {
        scanWifiBtn.addEventListener("click", async () => {
            if (window.location.protocol === "https:") {
                if (confirm("⚠️ หน้าเว็บบน HTTPS ไม่สามารถสแกน Wi-Fi ตรงได้\n\nกด OK เพื่อเปิดไปยังหน้าตั้งค่าของ ESP32 (http://192.168.4.1)")) {
                    window.location.href = "http://192.168.4.1";
                }
                return;
            }

            try {
                const response = await fetch("http://192.168.4.1/api/scan-wifi");
                const wifiList = await response.json();
                if (Array.isArray(wifiList) && wifiList.length > 0 && homeSsidInput) {
                    homeSsidInput.value = wifiList[0];
                }
            } catch (err) {
                alert("❌ สแกนล้มเหลว กรุณาเชื่อมต่อ Wi-Fi 'FishFeeder-Setup' แล้วเข้า http://192.168.4.1");
            }
        });
    }

    if (connectWifiBtn) {
        connectWifiBtn.addEventListener("click", async () => {
            const ssid = homeSsidInput?.value.trim();
            const pass = homePasswordInput?.value.trim() || "";

            if (!ssid) return alert("กรุณาเลือกหรือกรอกชื่อ SSID Wi-Fi บ้าน");

            try {
                const response = await fetch(`/api/save-wifi?ssid=${encodeURIComponent(ssid)}&pass=${encodeURIComponent(pass)}`, {
                    method: "POST"
                });
                const resData = await response.json();
                if (resData.success) {
                    alert("✅ ส่งข้อมูลสำเร็จ! ESP32 กำลังเชื่อมต่อ Wi-Fi บ้าน");
                }
            } catch (err) {
                alert("❌ ติดต่อ Server หรือ ESP32 ไม่ได้!");
            }
        });
    }

    const existingAuth = getAuth();
    if (existingAuth || !elements.authModal) {
        hideAuthModal();
        startApp(existingAuth || { deviceId: "device123", deviceCode: "1234" });
    } else {
        showAuthModal();
    }

    setInterval(loadStatus, 2000);
});