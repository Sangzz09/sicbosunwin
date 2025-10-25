import express from "express";
import axios from "axios";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

// --- API Nguồn ---
const API_URL = "https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=100&tableId=39791215743193&curPage=1";
const UPDATE_INTERVAL = 15000; // 15 giây tránh bị chặn 429
const DATA_FILE = "./data.json";

// --- Biến lưu ---
let historyData = [];
let stats = { total: 0, predicted: 0, correct: 0, wrong: 0 };

// --- Tạo file dữ liệu nếu chưa có ---
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf-8");

// --- Load dữ liệu ---
try {
  historyData = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  if (!Array.isArray(historyData)) historyData = [];
} catch {
  historyData = [];
}

// --- Lưu dữ liệu ---
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(historyData.slice(0, 50), null, 2), "utf-8");
}

// --- Phân loại Tài/Xỉu ---
function getTaiXiu(score) {
  if (score >= 4 && score <= 10) return "Xỉu";
  if (score >= 11 && score <= 17) return "Tài";
  return "N/A";
}

// --- Cập nhật thống kê ---
function updateStats() {
  const predicted = historyData.filter(h => h.prediction);
  const correct = predicted.filter(h => getTaiXiu(h.score) === h.prediction);
  stats = {
    total: historyData.length,
    predicted: predicted.length,
    correct: correct.length,
    wrong: predicted.length - correct.length,
    accuracy: predicted.length ? ((correct.length / predicted.length) * 100).toFixed(2) + "%" : "0%"
  };
}

// --- Fetch dữ liệu mới ---
async function fetchLatestData() {
  try {
    const res = await axios.get(API_URL);
    return res?.data?.data?.resultList || [];
  } catch (err) {
    console.error("⚠️ Lỗi fetch API:", err.message);
    return null;
  }
}

// --- Cập nhật dữ liệu mới ---
async function updateHistory() {
  const newData = await fetchLatestData();
  if (!newData) return;

  if (historyData.length === 0) {
    historyData = newData;
    saveData();
    console.log(`🆕 Khởi tạo ${historyData.length} phiên`);
    return;
  }

  const latestKnown = historyData[0]?.gameNum;
  const index = newData.findIndex(x => x.gameNum === latestKnown);
  if (index > 0) {
    const newEntries = newData.slice(0, index);
    newEntries.forEach(entry => (entry.ket_qua = getTaiXiu(entry.score)));
    historyData.unshift(...newEntries);
    historyData = historyData.slice(0, 50);
    saveData();
    updateStats();
    console.log(`✅ Cập nhật thêm ${newEntries.length} phiên mới`);
  }
}

// --- Dự đoán nâng cao ---
function predictNext(history) {
  if (history.length < 5) {
    return { prediction: "N/A", confidence: "0", Vi: [], loaiCau: "Chưa đủ dữ liệu" };
  }

  const last5 = history.slice(0, 5);
  const taiCount = last5.filter(h => getTaiXiu(h.score) === "Tài").length;
  const xiuCount = 5 - taiCount;

  // --- Dự đoán chính ---
  const prediction = taiCount > xiuCount ? "Tài" : xiuCount > taiCount ? "Xỉu" : getTaiXiu(history[0].score);

  // --- Độ tin cậy ---
  const diff = Math.abs(taiCount - xiuCount);
  const confidence = ((diff / 5) * 50 + 50).toFixed(2); // 50–100%

  // --- Loại cầu ---
  const last3 = history.slice(0, 3);
  let loaiCau = "Sunwin";
  if (last3.every(h => getTaiXiu(h.score) === getTaiXiu(last3[0].score))) loaiCau = "Liên tục";
  const last5Alt = history.slice(0, 5);
  if (last5Alt.every((h, i, a) => i === 0 || getTaiXiu(h.score) !== getTaiXiu(a[i - 1].score))) loaiCau = "Đảo liên tục";

  // --- Logic “Vị” thông minh ---
  const scores = history.slice(0, 15).map(h => h.score);
  const freq = {};
  scores.forEach(s => (freq[s] = (freq[s] || 0) + 1));
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).map(([n]) => Number(n));
  let Vi = sorted.slice(0, 3);
  while (Vi.length < 3) {
    const rand = prediction === "Tài" ? Math.floor(Math.random() * 7) + 11 : Math.floor(Math.random() * 7) + 4;
    if (!Vi.includes(rand)) Vi.push(rand);
  }

  return { prediction, confidence, Vi, loaiCau };
}

// --- Endpoint gốc ---
app.get("/", (req, res) => {
  res.json({
    message: "🎲 Sicbo Sunwin API v5.1",
    endpoints: [
      { path: "/sicbosun/latest", desc: "Phiên mới nhất + dự đoán" },
      { path: "/api/sunwin/history", desc: "Toàn bộ lịch sử và thống kê" }
    ],
    Dev: "@minhsangdangcap"
  });
});

// --- Endpoint chính /sicbosun/latest ---
app.get("/sicbosun/latest", (req, res) => {
  if (historyData.length === 0)
    return res.status(503).json({ error: "Dữ liệu đang tải..." });

  const latest = historyData[0];
  const nextPhien = parseInt(latest.gameNum.replace("#", "")) + 1;
  const { prediction, confidence, Vi, loaiCau } = predictNext(historyData);
  latest.prediction = prediction;

  updateStats();

  res.json({
    phien: latest.gameNum,
    xuc_xac: latest.facesList || [],
    tong_diem: latest.score || 0,
    ket_qua: getTaiXiu(latest.score),
    phien_tiep_theo: `#${nextPhien}`,
    du_doan: prediction,
    do_tin_cay: `${confidence}%`,
    vi: Vi,
    loai_cau: loaiCau,
    thong_ke: {
      tong_phien: stats.total,
      so_du_doan: stats.predicted,
      dung: stats.correct,
      sai: stats.wrong,
      ti_le_dung: stats.accuracy
    },
    Dev: "@minhsangdangcap"
  });
});

// --- Endpoint /api/sunwin/history ---
app.get("/api/sunwin/history", (req, res) => {
  updateStats();
  res.json({
    tong_phien: stats.total,
    so_du_doan: stats.predicted,
    dung: stats.correct,
    sai: stats.wrong,
    ti_le_dung: stats.accuracy,
    data: historyData,
    Dev: "@minhsangdangcap"
  });
});

// --- Khởi chạy server ---
app.listen(PORT, () => {
  console.log(`🚀 Server chạy tại http://localhost:${PORT}`);
  updateHistory();
  setInterval(updateHistory, UPDATE_INTERVAL);
});
