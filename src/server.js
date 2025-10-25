// =====================================================
// SICBO SUNWIN PREDICTOR v9.0
// Dev: @minhsangdangcap
// =====================================================

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
let thongKe = { soDung: 0, soSai: 0, chuoiSai: 0, heSoTinCay: 1.0 };

// --- Tạo file lưu ---
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf-8");
try {
  historyData = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
} catch {
  historyData = [];
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(historyData, null, 2), "utf-8");
}

// --- Xử lý ---
function getTaiXiu(score) {
  if (score >= 4 && score <= 10) return "Xỉu";
  if (score >= 11 && score <= 17) return "Tài";
  return "N/A";
}

async function fetchLatest() {
  try {
    const res = await axios.get(API_URL);
    return res?.data?.data?.resultList || [];
  } catch {
    return [];
  }
}

// =====================================================
// 🎯 HỆ DỰ ĐOÁN NÂNG CAO (NHIỀU THUẬT TOÁN)
// =====================================================

// Thuật toán 1: Theo cầu liền & đảo
function thuatToanCau(history) {
  const last = history.slice(0, 6);
  if (last.length < 3) return { duDoan: "Đang thu thập", loaiCau: "Chưa xác định", doTinCay: 0 };

  const giaiTri = last.map((x) => getTaiXiu(x.score));
  let loaiCau = "Bình thường";
  let duDoan = "Tài";

  if (giaiTri.every((v) => v === giaiTri[0])) {
    loaiCau = "Cầu liền mạch";
    duDoan = giaiTri[0];
  } else if (giaiTri.every((v, i) => i === 0 || v !== giaiTri[i - 1])) {
    loaiCau = "Cầu đảo";
    duDoan = giaiTri[0] === "Tài" ? "Xỉu" : "Tài";
  }

  return { duDoan, loaiCau, doTinCay: 70 };
}

// Thuật toán 2: Theo tần suất lệch
function thuatToanTanSuat(history) {
  const last10 = history.slice(0, 10);
  const tai = last10.filter((x) => getTaiXiu(x.score) === "Tài").length;
  const xiu = last10.length - tai;

  let loaiCau = "Cầu cân bằng";
  let duDoan = "Tài";

  if (tai - xiu >= 6) {
    loaiCau = "Cầu lệch sâu (Tài nhiều)";
    duDoan = "Xỉu";
  } else if (xiu - tai >= 6) {
    loaiCau = "Cầu lệch sâu (Xỉu nhiều)";
    duDoan = "Tài";
  } else if (Math.abs(tai - xiu) <= 2) {
    loaiCau = "Cầu cân bằng";
    duDoan = "Tài";
  } else {
    loaiCau = "Cầu lệch nhẹ";
    duDoan = tai > xiu ? "Xỉu" : "Tài";
  }

  return { duDoan, loaiCau, doTinCay: 80 };
}

// Thuật toán 3: Phát hiện mẫu lặp 2-2, 1-1
function thuatToanMauLap(history) {
  const g = history.slice(0, 8).map((x) => getTaiXiu(x.score));
  if (g.length < 6) return { duDoan: "Đang thu thập", loaiCau: "Chưa xác định", doTinCay: 0 };

  let loaiCau = "Bình thường";
  let duDoan = "Tài";

  const last4 = g.slice(0, 4);
  const pattern = last4.join("-");

  if (pattern === "Tài-Xỉu-Tài-Xỉu" || pattern === "Xỉu-Tài-Xỉu-Tài") {
    loaiCau = "Cầu 1-1 (Xen kẽ)";
    duDoan = g[0] === "Tài" ? "Xỉu" : "Tài";
  } else if (
    (g[0] === g[1] && g[2] === g[3] && g[0] !== g[2]) ||
    (g[1] === g[2] && g[3] === g[4] && g[1] !== g[3])
  ) {
    loaiCau = "Cầu 2-2 (Cặp đôi)";
    duDoan = g[0] === "Tài" ? "Xỉu" : "Tài";
  }

  return { duDoan, loaiCau, doTinCay: 85 };
}

// =====================================================
// 🧠 Tổng hợp kết quả dự đoán
// =====================================================
function duDoanTongHop(history) {
  const t1 = thuatToanCau(history);
  const t2 = thuatToanTanSuat(history);
  const t3 = thuatToanMauLap(history);

  const duDoanCuoi =
    [t1, t2, t3].filter((t) => t.duDoan !== "Đang thu thập")
      .sort((a, b) => b.doTinCay - a.doTinCay)[0] || t1;

  const chuoiThang = tinhChuoiThang(history, duDoanCuoi.duDoan);
  const doTinCay = duDoanCuoi.doTinCay * thongKe.heSoTinCay;

  return {
    duDoan: duDoanCuoi.duDoan,
    loaiCau: duDoanCuoi.loaiCau,
    doTinCay: Math.min(doTinCay, 99.9).toFixed(1),
    chuoiThang,
  };
}

function tinhChuoiThang(history, duDoan) {
  let dem = 0;
  for (const v of history) {
    if (getTaiXiu(v.score) === duDoan) dem++;
    else break;
  }
  return dem;
}

// --- Cập nhật thống kê ---
function capNhatThongKe(duDoan, ketQua) {
  if (duDoan === "Đang thu thập") return;

  if (duDoan === ketQua) {
    thongKe.soDung++;
    thongKe.chuoiSai = 0;
    thongKe.heSoTinCay = Math.min(thongKe.heSoTinCay + 0.02, 1.2);
  } else {
    thongKe.soSai++;
    thongKe.chuoiSai++;
    thongKe.heSoTinCay = Math.max(thongKe.heSoTinCay - 0.05, 0.7);
  }

  if (thongKe.chuoiSai >= 5) {
    thongKe.chuoiSai = 0;
    thongKe.heSoTinCay = 1.0;
  }
}

// --- Cập nhật lịch sử ---
async function updateHistory() {
  const newData = await fetchLatest();
  if (!newData.length) return;

  if (historyData.length === 0) {
    historyData = newData;
    saveData();
    return;
  }

  const latestKnown = historyData[0].gameNum;
  const idx = newData.findIndex((x) => x.gameNum === latestKnown);
  if (idx > 0) {
    const add = newData.slice(0, idx);
    add.forEach(() => {
      const { duDoan } = duDoanTongHop(historyData);
      const ketQua = getTaiXiu(historyData[0].score);
      capNhatThongKe(duDoan, ketQua);
    });
    historyData.unshift(...add);
    saveData();
  }
}

// =====================================================
// 🔥 API
// =====================================================
app.get("/", (req, res) => {
  res.json({
    "Thông báo": "API Sicbo Sunwin Predictor v9.0 đang hoạt động!",
    "Các endpoint": ["/sicbosun/latest", "/sicbosun/history"],
    Dev: "@minhsangdangcap",
  });
});

app.get("/sicbosun/latest", (req, res) => {
  if (historyData.length === 0)
    return res.status(503).json({ lỗi: "Chưa có dữ liệu." });

  const latest = historyData[0];
  const nextPhien = parseInt(latest.gameNum.replace("#", "")) + 1;
  const { duDoan, doTinCay, loaiCau, chuoiThang } = duDoanTongHop(historyData);
  const ketQua = getTaiXiu(latest.score);

  res.json({
    "Phiên hiện tại": latest.gameNum,
    "Tổng điểm": latest.score,
    "Kết quả": ketQua,
    "Phiên kế tiếp": `#${nextPhien}`,
    "Dự đoán": duDoan,
    "Độ tin cậy": `${doTinCay}%`,
    "Loại cầu": loaiCau,
    "Chuỗi thắng liên tục": `${chuoiThang} phiên`,
    "Thống kê": {
      "Số đúng": thongKe.soDung,
      "Số sai": thongKe.soSai,
      "Tỉ lệ đúng": (
        (thongKe.soDung / (thongKe.soDung + thongKe.soSai || 1)) *
        100
      ).toFixed(1) + "%",
    },
    Dev: "@minhsangdangcap",
  });
});

app.get("/sicbosun/history", (req, res) => {
  res.json({
    "Tổng số phiên lưu": historyData.length,
    "20 phiên gần nhất": historyData.slice(0, 20),
    Dev: "@minhsangdangcap",
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server chạy tại: http://localhost:${PORT}/sicbosun/latest`);
  updateHistory();
  setInterval(updateHistory, UPDATE_INTERVAL);
});
