// =====================================
// Fish Feeder IoT - Integrated App Script
// =====================================

// 🟢 1. Import Firebase Firestore Web SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// 🟢 2. ใส่ค่า Firebase Config ของคุณตรงนี้ (ดึงมาจาก Firebase Console)
const firebaseConfig = {
    apiKey: "AIzaSyBjVm1W-7XVz_nyCetLcXhqI_XsA3sSneY",
    authDomain: "kaptun-e8c23.firebaseapp.com",
    databaseURL: "https://kaptun-e8c23-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "kaptun-e8c23",
    storageBucket: "kaptun-e8c23.firebasestorage.app",
    messagingSenderId: "328923986439",
    appId: "1:328923986439:web:8cb42e97592936903c88a2"
};

// Initialize Firebase & Firestore
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// 🟢 ฟังก์ชันสำหรับเพิ่ม Alert ลงใน Firestore (Collection: 'alerts')
async function saveAlertToFirestore(level, message) {
    try {
        await addDoc(collection(db, "alerts"), {
            level: level, // เช่น "info", "warning", "danger"
            message: message,
            timestamp: serverTimestamp()
        });
        console.log("✅ บันทึก Alert ลง Firestore สำเร็จ");
    } catch (error) {
        console.error("❌ เกิดข้อผิดพลาดในการบันทึก Alert ลง Firestore:", error);
    }
}

// ---------- DOM Elements ----------
const statusText = document.getElementById("statusText");
const lastSeen = document.getElementById("lastSeen");
const weight = document.getElementById("weight");
const daysRemainingText = document.getElementById("daysRemainingText");
const dailyUsage = document.getElementById("dailyUsage");
const saveUsageBtn = document.getElementById("saveUsageBtn");

const alertList = document.getElementById("alertList");
const scheduleList = document.getElementById("scheduleList");

const feedBtn = document.getElementById("feedBtn");
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
const FEED_AMOUNT_KEY = "fishfeeder_feed_amount";

let currentMode = localStorage.getItem(MODE_KEY) || "cloud";
const MAX_CAPACITY_GRAMS = 1000;

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
    const auth = getAuth() || { deviceId: "device123", deviceCode: "1234" };
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
// HELPER & REALTIME CALCULATIONS
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

function updateRealtimeWeightUI(realWeightGrams, dailyUsageValue = 100) {
    const currentWeight = Math.max(0, Number(realWeightGrams) || 0);
    const usage = dailyUsageValue > 0 ? dailyUsageValue : 100;
    const daysRemaining = (currentWeight / usage).toFixed(1);

    const tankWeightText = document.getElementById("tankWeightText");
    const daysText = document.getElementById("daysRemainingText");
    const progressBar = document.getElementById("tankProgressBar");
    const foodStatusBadge = document.getElementById("foodStatusBadge");

    if (tankWeightText) tankWeightText.innerText = `${currentWeight} g`;
    if (weight) weight.innerText = currentWeight;
    if (daysText) daysText.innerText = `${daysRemaining} วัน`;

    if (progressBar) {
        const fillPercent = Math.min((currentWeight / MAX_CAPACITY_GRAMS) * 100, 100);
        progressBar.style.width = `${fillPercent}%`;
    }

    if (foodStatusBadge) {
        if (daysRemaining < 3) {
            foodStatusBadge.className = "status-badge red";
            foodStatusBadge.innerText = "🔴 เติมอาหาร ";
        } else if (daysRemaining < 7) {
            foodStatusBadge.className = "status-badge yellow";
            foodStatusBadge.innerText = "🟡 อาหารเหลือน้อย ";
        } else {
            foodStatusBadge.className = "status-badge green";
            foodStatusBadge.innerText = "🟢 อาหารเพียงพอ ";
        }
    }
}

function updateSystemLeds(isPowerOn = true, isApMode = false, isMqttReady = true) {
    const ledPower = document.getElementById("ledPower");
    const ledAp = document.getElementById("ledAp");
    const ledMqtt = document.getElementById("ledMqtt");

    if (ledPower) ledPower.classList.toggle("active", isPowerOn);
    if (ledAp) ledAp.classList.toggle("active", isApMode);
    if (ledMqtt) ledMqtt.classList.toggle("active", isMqttReady);
}

// =====================================
// API CALLS
// =====================================
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

// =====================================
// LOADERS & RENDERS
// =====================================
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

// =====================================
// REALTIME TOP-BAR STATUS CONTROL
// =====================================
function updateConnectionStatusUI(isOnline = false) {
    const connStatus = document.getElementById("connectionStatus");
    if (!connStatus) return;

    const currentControlMode = localStorage.getItem("fishfeeder_mode") || "cloud";

    if (currentControlMode === "local") {
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

function updateStatus(data) {
    const isOnline = data && data.online === true;
    updateConnectionStatusUI(isOnline);

    const currentWeight = data?.weight || 0;
    const usageVal = Number(data?.dailyUsage || 100);
    if (typeof updateRealtimeWeightUI === "function") {
        updateRealtimeWeightUI(currentWeight, usageVal);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const btnCloud = document.getElementById("btn-cloud") || document.getElementById("btnCloud");
    const btnLocal = document.getElementById("btn-local") || document.getElementById("btnLocal");

    btnCloud?.addEventListener("click", () => {
        localStorage.setItem("fishfeeder_mode", "cloud");
        loadStatus();
    });

    btnLocal?.addEventListener("click", () => {
        localStorage.setItem("fishfeeder_mode", "local");
        updateConnectionStatusUI(false);
    });
});

function renderAlerts(alerts) {
    if (!alertList) return;
    alertList.innerHTML = "";
    if (!Array.isArray(alerts)) return;

    alerts.forEach(alert => {
        const li = document.createElement("li");
        li.className = "list-group-item";
        li.innerHTML = `<strong>${escapeHtml((alert.level || "").toUpperCase())}</strong><br>${escapeHtml(alert.message)}`;
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
    const payload = schedules.map(item => ({ time: item.time, enable: true }));
    const result = await postJSON("/api/schedule", { schedules: payload });
    if (result && result.success === false) alert(result.message);
    loadSchedule();
}

// =====================================
// APP MAIN INIT & SOCKET LISTENERS
// =====================================
let socket = null;

function startApp(auth) {
    setControlMode(currentMode);

    if (typeof io !== "undefined") {
        socket = io({ auth: { deviceId: auth.deviceId, deviceCode: auth.deviceCode } });

        socket.on("connect", () => updateSystemLeds(true, false, true));
        socket.on("connect_error", (err) => {
            console.warn("Socket Error:", err.message);
            updateSystemLeds(true, false, false);
        });

        socket.on("status", updateStatus);
        socket.on("weight", (data) => {
            const usageVal = Number(dailyUsage?.value || 100);
            updateRealtimeWeightUI(data.weight, usageVal);
            updateSystemLeds(true, false, true);
        });

        socket.on("history", (data) => processHistoryData(data));
        socket.on("alerts", renderAlerts);
        socket.on("alert", loadAlerts);
        socket.on("schedule", renderSchedule);
    }

    if (btnCloud) btnCloud.addEventListener("click", () => setControlMode("cloud"));
    if (btnLocal) btnLocal.addEventListener("click", () => setControlMode("local"));

    saveUsageBtn?.addEventListener("click", async () => {
        const usage = Number(dailyUsage?.value || 0);
        if (usage <= 0) return alert("Daily usage must be greater than 0");
        await postJSON("/api/usage", { dailyUsage: usage });
        alert("Daily usage updated");
    });

    // 🟢 ปุ่มกดสั่งให้อาหาร (เพิ่มบันทึก Firestore สำหรับ Local Mode)
    feedBtn?.addEventListener("click", async () => {
        const grams = Number(feedAmount?.value || 10);
        if (grams <= 0) return alert("กรุณาระบุปริมาณอาหารมากกว่า 0 กรัม");

        const originalText = feedBtn.textContent;
        feedBtn.disabled = true;
        feedBtn.textContent = "⏳ กำลังส่งคำสั่ง...";

        try {
            if (currentMode === "cloud") {
                const result = await postJSON('/api/feed', { grams: grams });
                
                if (result && result.success) {
                    alert("✅ [Cloud Mode] ส่งคำสั่งเรียบร้อย!");
                } else {
                    alert(`❌ ${result?.message || "ส่งไม่สำเร็จ"}`);
                }
            } else {
                // 🟢 โหมด Local Mode (ยิงตรงไปที่ ESP32)
                const espIp = espIpInput ? espIpInput.value.trim() : "";
                if (!espIp) return alert("กรุณากรอก IP Address ของอุปกรณ์");
                localStorage.setItem(LOCAL_IP_KEY, espIp);

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000);
                const response = await fetch(`http://${espIp}/local-feed?amount=${grams}`, { signal: controller.signal });
                clearTimeout(timeoutId);

                if (response.ok) {
                    // 🟢 เมื่อยิง Local สำเร็จ ให้บันทึก Alert ลง Firestore ทันที
                    await saveAlertToFirestore("info", `ให้อาหารสัตว์เลี้ยงเรียบร้อยแล้ว (${grams} กรัม - Local Mode)`);
                    alert("✅ [Local Mode] สั่งให้อาหารสำเร็จ!");
                } else {
                    alert("❌ บอร์ดตอบกลับข้อผิดพลาด");
                }
            }
        } catch (err) {
            alert(currentMode === "local" ? "❌ ติดต่อบอร์ดไม่ได้!" : "❌ เชื่อมต่อ Cloud API ล้มเหลว");
        } finally {
            feedBtn.disabled = false;
            feedBtn.textContent = originalText;
        }
    });

    stopBtn?.addEventListener("click", async () => {
        try {
            if (currentMode === "cloud") {
                const result = await postJSON("/api/stop", {});
                alert(result && result.success ? "🛑 ส่งคำสั่งหยุดแล้ว" : "❌ หยุดไม่สำเร็จ");
            } else {
                const espIp = espIpInput ? espIpInput.value.trim() : "";
                if (!espIp) return alert("กรุณากรอก IP Address ของอุปกรณ์");
                await fetch(`http://${espIp}/local-stop`);
                
                // 🟢 บันทึกการกดหยุดฉุกเฉินลง Firestore
                await saveAlertToFirestore("danger", "หยุดการให้อาหารฉุกเฉิน (Local Mode)");
                alert("🛑 [Local Mode] ส่งคำสั่งหยุดแล้ว");
            }
        } catch (err) {
            alert("❌ ส่งคำสั่งหยุดล้มเหลว");
        }
    });

    addSchedule?.addEventListener("click", () => {
        if (!scheduleTime || !scheduleTime.value) return alert("Please select time");
        schedules.push({ time: scheduleTime.value, enable: true });
        saveSchedule();
        scheduleTime.value = "";
    });

    clearHistory?.addEventListener("click", async () => {
        if (confirm("คุณต้องการล้างประวัติการให้อาหารทั้งหมดใช่หรือไม่?")) {
            await deleteAPI("/api/history");
            loadHistory();
        }
    });

    loadStatus();
    loadHistory();
    loadAlerts();
    loadSchedule();
}

// =====================================
// AUTH GATE & DOM CONTROLS
// =====================================
authForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const deviceId = authDeviceId?.value.trim();
    const deviceCode = authDeviceCode?.value.trim();
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

logoutBtn?.addEventListener("click", () => {
    clearAuthStorage();
    if (socket) socket.disconnect();
    location.reload();
});

// ---------- DOM Ready UI Controls ----------
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

    const modeToggle = document.getElementById("modeToggle");
    const labelAuto = document.getElementById("label-auto");
    const labelManual = document.getElementById("label-manual");
    const statusCurrentMode = document.getElementById("statusCurrentMode");

    function updateModeUI(isManual) {
        if (isManual) {
            labelManual?.classList.add("active");
            labelAuto?.classList.remove("active");
            if (statusCurrentMode) {
                statusCurrentMode.innerText = "Manual";
                statusCurrentMode.className = "status-value-text blue";
            }
            if (feedBtn) feedBtn.disabled = false;
            if (feedAmount) feedAmount.disabled = false;
        } else {
            labelAuto?.classList.add("active");
            labelManual?.classList.remove("active");
            if (statusCurrentMode) {
                statusCurrentMode.innerText = "Auto";
                statusCurrentMode.className = "status-value-text green";
            }
            if (feedBtn) feedBtn.disabled = true;
            if (feedAmount) feedAmount.disabled = true;
        }
    }

    if (modeToggle) {
        modeToggle.addEventListener("change", (e) => updateModeUI(e.target.checked));
        modeToggle.checked = false;
        updateModeUI(false);
    }

    const existingAuth = getAuth();
    if (existingAuth || !authModal) {
        hideAuthModal();
        startApp(existingAuth || { deviceId: "DEV01", deviceCode: "1234" });
    } else {
        showAuthModal();
    }
});

// =====================================
// TAB NAVIGATION SWITCH LOGIC (schedule.html)
// =====================================
document.addEventListener("DOMContentLoaded", () => {
    const tabScheduleBtn = document.getElementById("tabScheduleBtn");
    const tabWeightBtn = document.getElementById("tabWeightBtn");
    const sectionSchedule = document.getElementById("section-schedule");
    const sectionWeight = document.getElementById("section-weight");

    if (tabScheduleBtn && tabWeightBtn) {
        tabScheduleBtn.addEventListener("click", () => {
            tabScheduleBtn.classList.add("active");
            tabWeightBtn.classList.remove("active");

            if (sectionSchedule) sectionSchedule.style.display = "block";
            if (sectionWeight) sectionWeight.style.display = "none";
        });

        tabWeightBtn.addEventListener("click", () => {
            tabWeightBtn.classList.add("active");
            tabScheduleBtn.classList.remove("active");

            if (sectionSchedule) sectionSchedule.style.display = "none";
            if (sectionWeight) sectionWeight.style.display = "block";
        });
    }
});

// =====================================
// SYNC FEED AMOUNT BETWEEN PAGES & USAGE
// =====================================
document.addEventListener("DOMContentLoaded", () => {
    const savedAmount = localStorage.getItem(FEED_AMOUNT_KEY) || "10";
    
    const feedAmountIndex = document.getElementById("feedAmount");
    if (feedAmountIndex) feedAmountIndex.value = savedAmount;

    const feedAmountSchedule = document.getElementById("feedAmountInput");
    if (feedAmountSchedule) feedAmountSchedule.value = savedAmount;
});

async function handleSaveCalibrationSettings() {
    const feedAmountVal = Number(document.getElementById("feedAmountInput")?.value || 10);

    if (feedAmountVal <= 0) {
        alert("กรุณากรอกปริมาณอาหารที่ใช้ต่อครั้งให้ถูกต้อง");
        return;
    }

    localStorage.setItem(FEED_AMOUNT_KEY, feedAmountVal);

    try {
        await postJSON("/api/usage", { dailyUsage: feedAmountVal });
        alert("บันทึกปริมาณอาหารต่อครั้งลง Firebase เรียบร้อย");
    } catch (e) {
        alert("บันทึกข้อมูลไม่สำเร็จ");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("saveCalibrationBtn")?.addEventListener("click", handleSaveCalibrationSettings);
});

// =====================================
// HISTORY FILTER, SUMMARY & PRINT LOGIC (history.html)
// =====================================
let rawHistoryData = [];

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

    const printDateText = document.getElementById("printDateRangeText");
    if (printDateText) {
        if (startDateVal && endDateVal) {
            printDateText.innerText = `ข้อมูลช่วงวันที่: ${startDateVal} ถึง ${endDateVal}`;
        } else if (startDateVal) {
            printDateText.innerText = `ข้อมูลตั้งแต่วันที่: ${startDateVal}`;
        } else if (endDateVal) {
            printDateText.innerText = `ข้อมูลถึงวันที่: ${endDateVal}`;
        } else {
            printDateText.innerText = `ข้อมูลช่วงวันที่: ทั้งหมด`;
        }
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
    const defaultDeviceId = currentAuth?.deviceId || "DEV01";

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
    document.getElementById("filterBtn")?.addEventListener("click", filterAndRenderHistory);

    document.getElementById("resetFilterBtn")?.addEventListener("click", () => {
        const startDateInput = document.getElementById("startDateInput");
        const endDateInput = document.getElementById("endDateInput");
        if (startDateInput) startDateInput.value = "";
        if (endDateInput) endDateInput.value = "";
        filterAndRenderHistory();
    });

    document.getElementById("printReportBtn")?.addEventListener("click", () => {
        window.print();
    });

    document.getElementById("clearHistoryBtn")?.addEventListener("click", async () => {
        if (confirm("คุณต้องการล้างประวัติการให้อาหารทั้งหมดใช่หรือไม่?")) {
            try {
                await deleteAPI("/api/history");
                loadHistory();
            } catch (e) {
                alert("เกิดข้อผิดพลาดในการล้างประวัติ");
            }
        }
    });
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
// SETTINGS PAGE - WIFI SCAN & CONNECT LOGIC
// =====================================
document.addEventListener("DOMContentLoaded", () => {
    const scanWifiBtn = document.getElementById("scanWifiBtn");
    const connectWifiBtn = document.getElementById("connectWifiBtn");
    const homeSsidInput = document.getElementById("homeSsidInput");
    const homePasswordInput = document.getElementById("homePasswordInput");
    const wifiListOptions = document.getElementById("wifiListOptions");

    if (scanWifiBtn) {
        scanWifiBtn.addEventListener("click", async () => {
            const originalText = scanWifiBtn.textContent;
            scanWifiBtn.disabled = true;
            scanWifiBtn.textContent = "⏳ กำลังสแกน...";

            try {
                const response = await fetch("http://192.168.4.1/api/scan-wifi");
                const wifiList = await response.json();

                if (Array.isArray(wifiList) && wifiList.length > 0) {
                    if (wifiListOptions) wifiListOptions.innerHTML = "";

                    const cleanList = [...new Set(wifiList)].filter(ssid => ssid && ssid.trim() !== "");

                    cleanList.forEach(ssid => {
                        const option = document.createElement("option");
                        option.value = ssid;
                        if (wifiListOptions) wifiListOptions.appendChild(option);
                    });

                    if (homeSsidInput && cleanList.length > 0) {
                        homeSsidInput.value = cleanList[0];
                    }
                }
            } catch (err) {
                console.error("สแกน Wi-Fi ไม่สำเร็จ:", err);
            } finally {
                scanWifiBtn.disabled = false;
                scanWifiBtn.textContent = originalText;
            }
        });
    }

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
                    method: "POST",
                    headers: { "Content-Type": "application/json" }
                });
            
                const resData = await response.json();

                if (resData.success) {
                    alert("✅ ส่งข้อมูลสำเร็จ! ESP32 กำลังเชื่อมต่อ Wi-Fi บ้าน");
                } else {
                    alert(`❌ ${resData.message || "บันทึกไม่สำเร็จ"}`);
                }
            } catch (err) {
                try {
                    await fetch(`http://192.168.4.1/api/save-wifi?ssid=${encodeURIComponent(ssid)}&pass=${encodeURIComponent(pass)}`, { mode: 'no-cors' });
                    alert("✅ ส่งคำสั่งไปยัง ESP32 เรียบร้อยแล้ว!");
                } catch (e) {
                    alert("❌ ติดต่อ ESP32 ไม่ได้! กรุณาตรวจสอบว่าเชื่อมต่อ Wi-Fi 'FishFeeder-Setup' อยู่หรือไม่");
                }
            } finally {
                connectWifiBtn.disabled = false;
                connectWifiBtn.textContent = "บันทึก / เชื่อมต่อ";
            }
        });
    }
});

// =====================================
// REAL-TIME WEIGHT UPDATE LOGIC
// =====================================
document.addEventListener("DOMContentLoaded", () => {
    const tankWeightText = document.getElementById("tankWeightText");
    const tankProgressBar = document.getElementById("tankProgressBar");
    const daysRemainingText = document.getElementById("daysRemainingText");
    const foodStatusBadge = document.getElementById("foodStatusBadge");

    const MAX_CAPACITY_GRAMS = 500;
    const DAILY_USAGE_GRAMS = 20;

    async function fetchRealtimeWeight() {
        try {
            const response = await fetch("/api/status", {
                headers: {
                    "x-device-id": "device123"
                }
            });

            if (!response.ok) throw new Error("ดึงข้อมูลไม่สำเร็จ");

            const data = await response.json();
            
            const weight = parseFloat(data.current_weight || data.weight_grams || 0);
            const formattedWeight = weight > 0 ? weight.toFixed(1) : "0";

            if (tankWeightText) {
                tankWeightText.textContent = `${formattedWeight} g`;
            }

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

        } catch (err) {
            console.error("Error fetching weight:", err);
        }
    }

    fetchRealtimeWeight();
    setInterval(fetchRealtimeWeight, 2000);
});