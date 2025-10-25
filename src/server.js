import express from "express";
import axios from "axios";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

// ====== Cấu hình hệ thống ======
const API_URL =
  "https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=100&tableId=39791215743193&curPage=1";
const UPDATE_INTERVAL = 5000; // 5 giây
const RESET_INTERVAL = 15 * 60 * 1000; // 15 phút
const MAX_HISTORY = 200; // Lưu tối đa 200 phiên
const KEEP_AFTER_RESET = 5; // Sau reset, giữ 5 phiên gần nhất
const DATA_FILE = "./data.json";

let historyData = [];

// ====== Khởi tạo data.json nếu chưa có ======
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf-8");

try {
  historyData = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
} catch {
  historyData = [];
}

// ====== Hàm lưu dữ liệu ======
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(historyData, null, 2), "utf-8");
}

// ====== Gọi API nguồn ======
async function fetchLatestData() {
  try {
    const res = await axios.get(API_URL);
    return res?.data?.data?.resultList || [];
  } catch (err) {
    console.error("⚠️ Lỗi fetch API:", err.message);
    return null;
  }
}

// ====== Phân loại Tài / Xỉu ======
function getTaiXiu(score) {
  if (score >= 4 && score <= 10) return "Xỉu";
  if (score >= 11 && score <= 17) return "Tài";
  return "N/A";
}

// ====== Cập nhật dữ liệu ======
async function updateHistory() {
  const newData = await fetchLatestData();
  if (!newData) return;

  if (historyData.length === 0) {
    historyData = newData.slice(0, MAX_HISTORY);
    saveData();
    console.log(`🔰 Khởi tạo ${historyData.length} phiên`);
    return;
  }

  const latestKnown = historyData[0].gameNum;
  const index = newData.findIndex((x) => x.gameNum === latestKnown);
  if (index > 0) {
    const newEntries = newData.slice(0, index);
    newEntries.forEach((e) => {
      e.ket_qua = getTaiXiu(e.score);
      e.trang_thai = "Chưa xác định";
    });
    historyData.unshift(...newEntries);
    historyData = historyData.slice(0, MAX_HISTORY);
    saveData();
    console.log(`✅ Cập nhật thêm ${newEntries.length} phiên mới`);
  }
}

// ====== Reset dữ liệu mỗi 15 phút ======
function autoReset() {
  if (historyData.length > KEEP_AFTER_RESET) {
    historyData = historyData.slice(0, KEEP_AFTER_RESET);
    saveData();
    console.log("♻️ Đã reset dữ liệu, giữ lại 5 phiên gần nhất.");
  }
}

// ====== Dự đoán phiên tiếp theo ======
function predictNext(history) {
  const last5 = history.slice(0, 5);
  let scoreTai = 0,
    scoreXiu = 0;

  last5.forEach((h) => {
    const r = getTaiXiu(h.score);
    if (r === "Tài") scoreTai++;
    if (r === "Xỉu") scoreXiu++;
  });

  const prediction = scoreTai >= scoreXiu ? "Tài" : "Xỉu";
  const confidence = Math.max(scoreTai, scoreXiu) / last5.length * 100;

  // Vi (3 tổng điểm khả năng cao)
  const lastTotals = history.slice(0, 20).map((h) => h.score);
  let Vi = Array.from(new Set(lastTotals)).slice(0, 3);
  while (Vi.length < 3) {
    const val =
      prediction === "Tài"
        ? Math.floor(Math.random() * 8) + 11
        : Math.floor(Math.random() * 8) + 3;
    if (!Vi.includes(val)) Vi.push(val);
  }

  // Loại cầu
  let loaiCau = "Sunwin";
  const last3 = history.slice(0, 3);
  if (
    last3.length === 3 &&
    last3.every((h) => getTaiXiu(h.score) === getTaiXiu(last3[0].score))
  )
    loaiCau = "Liên tục";

  const last5Check = history.slice(0, 5);
  if (
    last5Check.length === 5 &&
    last5Check.every(
      (h, i, a) => i === 0 || getTaiXiu(h.score) !== getTaiXiu(a[i - 1].score)
    )
  )
    loaiCau = "Đảo liên tục";

  return {
    prediction,
    confidence: confidence.toFixed(2),
    Vi,
    loaiCau,
  };
}

// ====== API ======

// Trang chủ
app.get("/", (req, res) => {
  res.json({
    message: "🔥 Sunwin API v3.1",
    endpoints: [
      { path: "/api/sunwin/latest", description: "Phiên mới nhất + dự đoán" },
      { path: "/api/sunwin/history", description: "Lịch sử phiên" },
      { path: "/sicbosun", description: "Cập nhật dữ liệu thủ công" },
    ],
    Dev: "@minhsangdangcap",
  });
});

// --- API: Phiên mới nhất ---
app.get("/api/sunwin/latest", (req, res) => {
  if (historyData.length === 0)
    return res.status(503).json({ error: "Dữ liệu đang tải..." });

  const latest = historyData[0];
  const nextPhien = parseInt(latest.gameNum.replace("#", "")) + 1;
  const { prediction, confidence, Vi, loaiCau } = predictNext(historyData);

  // Cập nhật trạng thái đúng/sai cho phiên trước
  if (historyData[1]) {
    const truoc = historyData[1];
    truoc.prediction = prediction;
    truoc.trang_thai =
      getTaiXiu(truoc.score) === truoc.prediction ? "Đúng" : "Sai";
  }

  saveData();

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
    Dev: "@minhsangdangcap",
  });
});

// --- API: Lịch sử ---
app.get("/api/sunwin/history", (req, res) => {
  if (historyData.length === 0)
    return res.status(503).json({ error: "Dữ liệu đang tải..." });

  const soDung = historyData.filter(
    (h) => h.trang_thai === "Đúng"
  ).length;
  const soSai = historyData.filter((h) => h.trang_thai === "Sai").length;
  const tiLe =
    historyData.length > 0
      ? ((soDung / historyData.length) * 100).toFixed(2) + "%"
      : "0%";

  res.json({
    tong_phien: historyData.length,
    so_dung: soDung,
    so_sai: soSai,
    ti_le_chinh_xac: tiLe,
    data: historyData,
    Dev: "@minhsangdangcap",
  });
});

// --- API: Thủ công cập nhật dữ liệu (/sicbosun) ---
app.get("/sicbosun", async (req, res) => {
  await updateHistory();
  res.json({
    message: "✅ Đã cập nhật dữ liệu thủ công thành công!",
    Dev: "@minhsangdangcap",
  });
});

// ====== Chạy Server ======
app.listen(PORT, () => {
  console.log(`🚀 Server chạy tại: http://localhost:${PORT}`);
  updateHistory();
  setInterval(updateHistory, UPDATE_INTERVAL);
  setInterval(autoReset, RESET_INTERVAL);
});
