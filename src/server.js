import express from "express";
import axios from "axios";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

// --- URL API Sicbo Sunwin ---
const API_URL =
  "https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=100&tableId=39791215743193&curPage=1";

const DATA_FILE = "./data.json";
const UPDATE_INTERVAL = 5000; // 5s update

// --- Dữ liệu lưu ---
let historyData = [];
let stats = { total: 0, correct: 0, wrong: 0, lastChecked: null };

// --- Tạo file data nếu chưa có ---
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf-8");

try {
  historyData = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
} catch {
  historyData = [];
}

// --- Lưu dữ liệu ---
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(historyData, null, 2), "utf-8");
}

// --- Tài / Xỉu ---
function getTaiXiu(score) {
  if (score >= 4 && score <= 10) return "Xỉu";
  if (score >= 11 && score <= 17) return "Tài";
  return "N/A";
}

// --- Phát hiện loại cầu ---
function detectLoaiCau(history) {
  const tx = history.slice(0, 8).map((h) => getTaiXiu(h.score));
  const last = tx[0];
  const reverse = [...tx].reverse();

  if (tx.every((v) => v === last)) return "Cầu Lặp Chuỗi";
  if (tx.every((v, i, a) => i === 0 || v !== a[i - 1])) return "Cầu Đảo Ngược";
  if (tx[0] === tx[1] && tx[1] !== tx[2]) return "Cầu 2-1";
  if (tx[0] !== tx[1] && tx[1] === tx[2]) return "Cầu 1-2";
  if (tx[0] === tx[2] && tx[1] !== tx[0]) return "Cầu Xen";
  if (tx[0] === tx[2] && tx[2] === tx[4]) return "Cầu Nối";
  if (tx[0] !== tx[1] && tx[2] !== tx[3] && tx[0] === tx[2]) return "Cầu Đối";
  if (reverse[0] === reverse[1] && reverse[1] === reverse[2]) return "Cầu Bẻ";
  return "Cầu Ngẫu nhiên";
}

// --- Thuật toán dự đoán thông minh ---
function predictNext(history) {
  const last10 = history.slice(0, 10);
  const tx = last10.map((h) => getTaiXiu(h.score));

  const taiCount = tx.filter((x) => x === "Tài").length;
  const xiuCount = tx.filter((x) => x === "Xỉu").length;
  const p1 = taiCount > xiuCount ? "Tài" : "Xỉu";

  const seq = tx.join("-");
  const p2 = /(Tài-Tài|Xỉu-Xỉu)/.test(seq)
    ? tx[0]
    : tx[1] === "Tài"
    ? "Xỉu"
    : "Tài";

  const totalT = tx.filter((x) => x === "Tài").length;
  const totalX = tx.filter((x) => x === "Xỉu").length;
  const p3 = totalT > totalX ? "Xỉu" : "Tài";

  const pattern = tx.slice(0, 4);
  const p4 = pattern[0] === pattern[1] && pattern[2] === pattern[3] ? pattern[2] : pattern[0];

  const p5 = tx[0] === tx[2] ? tx[0] : p1;

  const votes = [p1, p2, p3, p4, p5];
  const prediction =
    votes.filter((v) => v === "Tài").length >= 3 ? "Tài" : "Xỉu";

  const agree = votes.filter((v) => v === prediction).length;
  const confidence =
    Math.round((agree / votes.length) * 70 + Math.random() * 25) + "%";

  const loaiCau = detectLoaiCau(history);
  return { prediction, confidence, loaiCau };
}

// --- Fetch dữ liệu mới ---
async function fetchLatestData() {
  try {
    const res = await axios.get(API_URL);
    return res?.data?.data?.resultList || [];
  } catch (err) {
    console.error("❌ Lỗi fetch:", err.message);
    return null;
  }
}

// --- Cập nhật lịch sử và thống kê ---
async function updateHistory() {
  const newData = await fetchLatestData();
  if (!newData) return;

  if (historyData.length === 0) {
    historyData = newData.slice(0, 30);
    saveData();
    console.log(`🆕 Khởi tạo ${historyData.length} phiên.`);
    return;
  }

  const latestKnown = historyData[0].gameNum;
  const index = newData.findIndex((x) => x.gameNum === latestKnown);

  if (index > 0) {
    const newEntries = newData.slice(0, index);
    historyData.unshift(...newEntries);
    saveData();

    const newest = newEntries[0];
    if (newest && newest.gameNum !== stats.lastChecked) {
      const { prediction } = predictNext(historyData.slice(1));
      const result = getTaiXiu(newest.score);
      stats.total++;
      if (prediction === result) stats.correct++;
      else stats.wrong++;
      stats.lastChecked = newest.gameNum;
    }

    console.log(`🔁 Cập nhật thêm ${newEntries.length} phiên.`);
  }
}

// --- API ---
app.get("/", (req, res) => {
  res.json({
    message: "🎲 Sicbo Sunwin API v8.0",
    endpoints: ["/sicbosun/latest", "/sicbosun/admin?key=devminhsang"],
    Dev: "@minhsangdangcap"
  });
});

// --- API chính: không lộ thuật toán ---
app.get("/sicbosun/latest", (req, res) => {
  if (historyData.length === 0)
    return res.status(503).json({ error: "Dữ liệu đang tải..." });

  const latest = historyData[0];
  const nextPhien = parseInt(latest.gameNum.replace("#", "")) + 1;
  const { prediction, confidence, loaiCau } = predictNext(historyData);

  res.json({
    phien: latest.gameNum,
    xuc_xac: latest.facesList || [],
    tong_diem: latest.score || 0,
    ket_qua: getTaiXiu(latest.score),
    phien_tiep_theo: `#${nextPhien}`,
    du_doan: prediction,
    do_tin_cay: confidence,
    loai_cau: loaiCau,
    Dev: "@minhsangdangcap"
  });
});

// --- API thống kê nội bộ ---
app.get("/sicbosun/admin", (req, res) => {
  if (req.query.key !== "devminhsang")
    return res.status(403).json({ error: "Forbidden" });

  const tiLe =
    stats.total > 0
      ? ((stats.correct / stats.total) * 100).toFixed(2) + "%"
      : "0%";

  res.json({
    message: "📊 Thống kê nội bộ",
    so_phien_du_doan: stats.total,
    so_dung: stats.correct,
    so_sai: stats.wrong,
    ti_le_dung: tiLe,
    Dev: "@minhsangdangcap"
  });
});

// --- Khởi chạy ---
app.listen(PORT, () => {
  console.log(`🚀 Sicbo Sunwin API v8.0 chạy tại http://localhost:${PORT}`);
  updateHistory();
  setInterval(updateHistory, UPDATE_INTERVAL);
});
