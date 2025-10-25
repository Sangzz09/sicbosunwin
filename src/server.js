// =======================================
// SICBO SUNWIN PRO PREDICTOR v6.5
// Dev: @minhsangdangcap
// Nâng cấp bởi GPT-5 (2025-10)
// =======================================

import express from "express";
import axios from "axios";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

const API_URL =
  "https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=50&tableId=39791215743193&curPage=1";
const DATA_FILE = "./data.json";
const UPDATE_INTERVAL = 5000;

let historyData = [];
let soDung = 0,
  soSai = 0;

// ====== KHỞI TẠO FILE LƯU ======
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf-8");
try {
  historyData = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
} catch {
  historyData = [];
}

// ====== HÀM LƯU FILE ======
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(historyData, null, 2), "utf-8");
}

// ====== HÀM GỌI API ======
async function fetchLatest() {
  try {
    const res = await axios.get(API_URL);
    return res?.data?.data?.resultList || [];
  } catch (err) {
    console.error("❌ Lỗi fetch API:", err.message);
    return [];
  }
}

// ====== HÀM CẬP NHẬT LỊCH SỬ ======
async function updateHistory() {
  const newData = await fetchLatest();
  if (!newData.length) return;

  if (historyData.length === 0) {
    historyData = newData;
    saveData();
    console.log("✅ Khởi tạo dữ liệu Sicbo!");
    return;
  }

  const latestKnown = historyData[0].gameNum;
  const idx = newData.findIndex((x) => x.gameNum === latestKnown);
  if (idx > 0) {
    const add = newData.slice(0, idx);
    historyData.unshift(...add);
    saveData();
    console.log(`🔁 Cập nhật thêm ${add.length} phiên`);
  }
}

// ====== XỬ LÝ KẾT QUẢ ======
function getTaiXiu(score) {
  if (score >= 4 && score <= 10) return "Xỉu";
  if (score >= 11 && score <= 17) return "Tài";
  return "N/A";
}

// ====== HỆ DỰ ĐOÁN CHÍNH ======
function heuristicPredict(history) {
  const last5 = history.slice(0, 5);
  const last10 = history.slice(0, 10);

  const count = (arr, type) =>
    arr.filter((x) => getTaiXiu(x.score) === type).length;

  const tai5 = count(last5, "Tài");
  const xiu5 = count(last5, "Xỉu");
  const tai10 = count(last10, "Tài");
  const xiu10 = count(last10, "Xỉu");

  // 3 hệ trọng: Ngắn hạn / Dài hạn / Lai thống kê
  const weights = {
    shortTerm: 0.6,
    longTerm: 0.3,
    pattern: 0.1,
  };

  const taiScore =
    tai5 * weights.shortTerm + tai10 * weights.longTerm + (tai10 - xiu10) * weights.pattern;
  const xiuScore =
    xiu5 * weights.shortTerm + xiu10 * weights.longTerm + (xiu10 - tai10) * weights.pattern;

  let duDoan = taiScore > xiuScore ? "Tài" : "Xỉu";
  const doTinCay = ((Math.abs(taiScore - xiuScore) / 10) * 100 + 50).toFixed(1);

  // ====== Dự đoán vị (ẩn logic) ======
  const tong = history.slice(0, 10).map((x) => x.score);
  const Vi = [...new Set(tong)].sort((a, b) => b - a).slice(0, 3);

  // ====== Loại cầu ======
  let loaiCau = "Bình thường";
  const last3 = history.slice(0, 3);
  if (last3.every((x) => getTaiXiu(x.score) === getTaiXiu(last3[0].score)))
    loaiCau = "Cầu liền mạch";
  if (
    last3.every(
      (x, i, a) => i === 0 || getTaiXiu(x.score) !== getTaiXiu(a[i - 1].score)
    )
  )
    loaiCau = "Cầu đảo";
  if (tai5 >= 4 || xiu5 >= 4) loaiCau = "Cầu lệch mạnh";
  if (tai10 === 5 && xiu10 === 5) loaiCau = "Cầu cân bằng";

  // ====== Chuỗi thắng liên tục ======
  let chuoiThang = 0;
  for (let i = 0; i < history.length - 1; i++) {
    if (getTaiXiu(history[i].score) === duDoan) chuoiThang++;
    else break;
  }

  return { duDoan, doTinCay, Vi, loaiCau, chuoiThang };
}

// ====== RESET KHI DỰ ĐOÁN SAI NHIỀU ======
function checkReset(prediction, ketQua) {
  if (prediction === ketQua) soDung++;
  else soSai++;

  const tong= soDung + soSai;
  const tiLe = tong > 0 ? (soDung / tong) * 100 : 0;

  if (soSai >= 5 && tiLe < 45) {
    console.log("⚠️ Reset hệ thống do sai quá nhiều!");
    soDung = 0;
    soSai = 0;
  }

  return { soDung, soSai, tiLe: tiLe.toFixed(1) + "%" };
}

// ====== API CHÍNH ======
app.get("/", (req, res) => {
  res.json({
    "Thông báo": "API Sicbo Sunwin đang hoạt động!",
    "Đường dẫn": ["/sicbosun/latest", "/sicbosun/history"],
    Dev: "@minhsangdangcap",
  });
});
