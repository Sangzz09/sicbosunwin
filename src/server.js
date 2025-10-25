// =====================================================
// SICBO SUNWIN PREDICTOR v7.0
// Dev: @minhsangdangcap
// Nâng cấp bởi GPT-5 (2025-10)
// =====================================================

const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

const API_URL =
  "https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=50&tableId=39791215743193&curPage=1";
const DATA_FILE = "./data.json";
const UPDATE_INTERVAL = 5000;

let historyData = [];
let soDung = 0;
let soSai = 0;
let heSoTinCay = 1.0; // hệ số tự điều chỉnh độ tin cậy

// =================== KHỞI TẠO FILE ===================
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf-8");
try {
  historyData = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
} catch {
  historyData = [];
}

// =================== HÀM LƯU FILE ===================
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(historyData, null, 2), "utf-8");
}

// =================== GỌI API ===================
async function fetchLatest() {
  try {
    const res = await axios.get(API_URL);
    return res?.data?.data?.resultList || [];
  } catch (err) {
    console.error("❌ Lỗi khi gọi API:", err.message);
    return [];
  }
}

// =================== CẬP NHẬT LỊCH SỬ ===================
async function updateHistory() {
  const newData = await fetchLatest();
  if (!newData.length) return;

  if (historyData.length === 0) {
    historyData = newData;
    saveData();
    console.log("✅ Đã khởi tạo dữ liệu Sicbo!");
    return;
  }

  const latestKnown = historyData[0].gameNum;
  const idx = newData.findIndex((x) => x.gameNum === latestKnown);
  if (idx > 0) {
    const add = newData.slice(0, idx);
    historyData.unshift(...add);
    saveData();
    console.log(`🔁 Cập nhật thêm ${add.length} phiên mới.`);
  }
}

// =================== XỬ LÝ KẾT QUẢ ===================
function getTaiXiu(score) {
  if (score >= 4 && score <= 10) return "Xỉu";
  if (score >= 11 && score <= 17) return "Tài";
  return "N/A";
}

// =================== DỰ ĐOÁN THÔNG MINH ===================
function duDoanThongMinh(history) {
  const last5 = history.slice(0, 5);
  const last10 = history.slice(0, 10);

  const count = (arr, type) =>
    arr.filter((x) => getTaiXiu(x.score) === type).length;

  const tai5 = count(last5, "Tài");
  const xiu5 = count(last5, "Xỉu");
  const tai10 = count(last10, "Tài");
  const xiu10 = count(last10, "Xỉu");

  // --- Nhiều hệ thống trọng số (ẩn khỏi JSON)
  const w1 = 0.6 * heSoTinCay; // trọng số ngắn hạn
  const w2 = 0.3; // dài hạn
  const w3 = 0.1; // mô hình mẫu

  const taiScore = tai5 * w1 + tai10 * w2 + (tai10 - xiu10) * w3;
  const xiuScore = xiu5 * w1 + xiu10 * w2 + (xiu10 - tai10) * w3;

  const duDoan = taiScore > xiuScore ? "Tài" : "Xỉu";
  const doTinCay = Math.min(
    (Math.abs(taiScore - xiuScore) * 10 + 50) * heSoTinCay,
    99.9
  ).toFixed(1);

  // --- Dự đoán vị (ẩn khỏi JSON)
  const tong = history.slice(0, 10).map((x) => x.score);
  const Vi = [...new Set(tong)].sort((a, b) => b - a).slice(0, 3);

  // --- Loại cầu (ẩn khỏi JSON)
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

  // --- Chuỗi thắng liên tục
  let chuoiThang = 0;
  for (let i = 0; i < history.length - 1; i++) {
    if (getTaiXiu(history[i].score) === duDoan) chuoiThang++;
    else break;
  }

  return { duDoan, doTinCay, Vi, loaiCau, chuoiThang };
}

// =================== RESET HỆ DỰ ĐOÁN ===================
function capNhatThongKe(prediction, ketQua) {
  if (prediction === ketQua) {
    soDung++;
    heSoTinCay = Math.min(heSoTinCay + 0.02, 1.2);
  } else {
    soSai++;
    heSoTinCay = Math.max(heSoTinCay - 0.05, 0.7);
  }

  const tong = soDung + soSai;
  const tiLe = tong > 0 ? (soDung / tong) * 100 : 0;

  if (soSai >= 5 && tiLe < 45) {
    console.log("⚠️ Reset dự đoán vì sai quá nhiều!");
    soDung = 0;
    soSai = 0;
    heSoTinCay = 1.0;
  }

  return { soDung, soSai, tiLe: tiLe.toFixed(1) + "%" };
}

// =================== API ===================
app.get("/", (req, res) => {
  res.json({
    "Thông báo": "API Sicbo Sunwin Predictor v7.0 đang hoạt động!",
    "Các endpoint khả dụng": ["/sicbosun/latest", "/sicbosun/history"],
    Dev: "@minhsangdangcap",
  });
});

// --- API chính ---
app.get("/sicbosun/latest", (req, res) => {
  if (historyData.length === 0)
    return res.status(503).json({ lỗi: "Chưa có dữ liệu." });

  const latest = historyData[0];
  const nextPhien = parseInt(latest.gameNum.replace("#", "")) + 1;
  const { duDoan, doTinCay, loaiCau, chuoiThang } = duDoanThongMinh(historyData);
  const ketQua = getTaiXiu(latest.score);
  const thongKe = capNhatThongKe(duDoan, ketQua);

  res.json({
    "Phiên hiện tại": latest.gameNum,
    "Xúc xắc": latest.facesList || [],
    "Tổng điểm": latest.score || 0,
    "Kết quả": ketQua,
    "Phiên kế tiếp": `#${nextPhien}`,
    "Dự đoán": duDoan,
    "Độ tin cậy": `${doTinCay}%`,
    "Loại cầu": loaiCau,
    "Chuỗi thắng liên tục": `${chuoiThang} phiên`,
    "Thống kê": {
      "Số đúng": thongKe.soDung,
      "Số sai": thongKe.soSai,
      "Tỉ lệ đúng": thongKe.tiLe,
    },
    Dev: "@minhsangdangcap",
  });
});

// --- Lịch sử gần nhất ---
app.get("/sicbosun/history", (req, res) => {
  res.json({
    "Tổng số phiên lưu": historyData.length,
    "20 phiên gần nhất": historyData.slice(0, 20),
    Dev: "@minhsangdangcap",
  });
});

// =================== CHẠY SERVER ===================
app.listen(PORT, () => {
  console.log(`🚀 Server chạy tại: http://localhost:${PORT}/sicbosun/latest`);
  updateHistory();
  setInterval(updateHistory, UPDATE_INTERVAL);
});
