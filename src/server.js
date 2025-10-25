import express from "express";
import axios from "axios";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

const API_URL =
  "https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=100&tableId=39791215743193&curPage=1";
const UPDATE_INTERVAL = 5000;
const DATA_FILE = "./data.json";

let historyData = [];
let stats = { total: 0, correct: 0, wrong: 0 };

// --- Tạo file data.json nếu chưa có ---
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf-8");

// --- Load lịch sử ---
try {
  historyData = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
} catch {
  historyData = [];
}

// --- Lưu dữ liệu ---
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(historyData, null, 2), "utf-8");
}

// --- Lấy dữ liệu mới ---
async function fetchLatestData() {
  try {
    const res = await axios.get(API_URL);
    const list = res?.data?.data?.resultList;
    if (!list) return [];
    return list;
  } catch (err) {
    console.error("Lỗi khi fetch API:", err.message);
    return null;
  }
}

// --- Cập nhật lịch sử ---
async function updateHistory() {
  const newData = await fetchLatestData();
  if (!newData) return;

  if (historyData.length === 0) {
    historyData = newData.slice(0, 20);
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
    console.log(`🔁 Cập nhật thêm ${newEntries.length} phiên.`);
  }
}

// --- Hàm xác định Tài/Xỉu ---
function getTaiXiu(score) {
  if (score >= 4 && score <= 10) return "Xỉu";
  if (score >= 11 && score <= 17) return "Tài";
  return "N/A";
}

// --- Phát hiện loại cầu nâng cao ---
function detectLoaiCau(history) {
  const tx = history.slice(0, 6).map((h) => getTaiXiu(h.score));
  const last = tx[0];

  if (tx.every((v) => v === tx[0])) return "Cầu Lặp";
  if (tx.every((v, i, a) => i === 0 || v !== a[i - 1])) return "Cầu Đảo";
  if (tx[0] === tx[2] && tx[1] === tx[3] && tx[0] !== tx[1]) return "Cầu Kẹp";
  if (tx[0] === tx[2] && tx[2] === tx[4]) return "Cầu Nối";
  if (tx[0] !== tx[1] && tx[1] === tx[2] && tx[2] !== tx[3]) return "Cầu Gãy";
  return "Cầu Ngẫu nhiên";
}

// --- Dự đoán ẩn (nhiều thuật toán phối hợp) ---
function predictNext(history) {
  const last5 = history.slice(0, 5);
  const last10 = history.slice(0, 10);

  const tx5 = last5.map((h) => getTaiXiu(h.score));
  const tx10 = last10.map((h) => getTaiXiu(h.score));

  // thuật toán 1: đếm tần suất gần nhất
  const taiCount = tx5.filter((v) => v === "Tài").length;
  const xiuCount = tx5.filter((v) => v === "Xỉu").length;
  let p1 = taiCount > xiuCount ? "Tài" : "Xỉu";

  // thuật toán 2: nhận dạng chuỗi xen kẽ
  let p2 = tx10[0] !== tx10[1] && tx10[1] !== tx10[2] ? tx10[0] : p1;

  // thuật toán 3: xu hướng 3 phiên
  const recent = tx5.slice(0, 3);
  let p3 = recent.filter((x) => x === "Tài").length >= 2 ? "Tài" : "Xỉu";

  // Tổng hợp dự đoán
  const votes = [p1, p2, p3];
  const prediction =
    votes.filter((v) => v === "Tài").length >= 2 ? "Tài" : "Xỉu";

  // Độ tin cậy
  const confidence =
    Math.round(
      (Math.max(taiCount, xiuCount) / last5.length +
        (p1 === p3 ? 0.2 : 0)) *
        50 +
        Math.random() * 20
    ) + "%";

  const loaiCau = detectLoaiCau(history);
  return { prediction, confidence, loaiCau };
}

// --- API chính ---
app.get("/", (req, res) => {
  res.json({
    message: "Sicbo Sunwin API",
    endpoints: ["/sicbosun/latest", "/sicbosun/admin?key=devminhsang"],
    Dev: "@minhsangdangcap",
  });
});

// --- Endpoint chính (JSON gọn, không lộ thuật toán) ---
app.get("/sicbosun/latest", (req, res) => {
  if (historyData.length === 0)
    return res.status(503).json({ error: "Dữ liệu đang tải..." });

  const latest = historyData[0];
  const nextPhien = parseInt(latest.gameNum.replace("#", "")) + 1;
  const { prediction, confidence, loaiCau } = predictNext(historyData);

  // cập nhật thống kê ngầm
  stats.total++;
  if (getTaiXiu(latest.score) === prediction) stats.correct++;
  else stats.wrong++;

  res.json({
    phien: latest.gameNum,
    xuc_xac: latest.facesList || [],
    tong_diem: latest.score || 0,
    ket_qua: getTaiXiu(latest.score),
    phien_tiep_theo: `#${nextPhien}`,
    du_doan: prediction,
    do_tin_cay: confidence,
    loai_cau: loaiCau,
    Dev: "@minhsangdangcap",
  });
});

// --- Endpoint ẩn: xem thống kê nội bộ ---
app.get("/sicbosun/admin", (req, res) => {
  const { key } = req.query;
  if (key !== "devminhsang") return res.status(403).json({ error: "Forbidden" });

  const tiLe =
    stats.total > 0
      ? ((stats.correct / stats.total) * 100).toFixed(2) + "%"
      : "0%";

  res.json({
    message: "Thống kê nội bộ (ẩn)",
    so_phien_du_doan: stats.total,
    so_dung: stats.correct,
    so_sai: stats.wrong,
    ti_le_dung: tiLe,
    Dev: "@minhsangdangcap",
  });
});

// --- Chạy server ---
app.listen(PORT, () => {
  console.log(`🚀 Server chạy tại http://localhost:${PORT}`);
  updateHistory();
  setInterval(updateHistory, UPDATE_INTERVAL);
});
