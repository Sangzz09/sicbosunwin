import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import fs from "fs";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const SOURCE_API = "https://sicbosun-100.onrender.com/api";

let history = [];
let lastPhien = null;
const MAX_PATTERN = 20;
const RESET_THRESHOLD = 5;

// Load data.json nếu có
if (fs.existsSync("data.json")) {
  try {
    history = JSON.parse(fs.readFileSync("data.json"));
    if (history.length > 0) lastPhien = history[history.length - 1].Phien;
  } catch {
    history = [];
  }
}

function saveData() {
  fs.writeFileSync("data.json", JSON.stringify(history, null, 2));
}

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { timeout: 5000 });
      if (!res.ok) throw new Error("Bad response");
      return await res.json();
    } catch (err) {
      if (i === retries - 1) throw err;
    }
  }
}

// Xác định loại cầu
function detectCau(history) {
  const last5 = history.slice(-5);
  const last3 = history.slice(-3);
  if (last3.length === 3 && last3.every(h => h.Ket_qua === last3[0].Ket_qua)) return "Liên tục";
  if (last5.length === 5 && last5.every((h, i, arr) => i === 0 || h.Ket_qua !== arr[i - 1].Ket_qua)) return "Đảo liên tục";
  return "Sunwin";
}

// Dự đoán Vi VIP dựa trên lịch sử 10–20 phiên
function predictViVIP(history, duDoan) {
  const lastTotals = history.slice(-20).map(h => h.Tong);
  const freq = {};
  lastTotals.forEach(t => freq[t] = (freq[t] || 0) + 1);

  // Sắp xếp theo tần suất xuất hiện
  let sortedTotals = Object.keys(freq).map(Number).sort((a,b) => freq[b]-freq[a]);

  // Nếu không đủ, thêm giá trị ngẫu nhiên trong khoảng Tài/Xỉu
  while (sortedTotals.length < 3) {
    const val = duDoan === "Tài"
      ? Math.floor(Math.random()*(18-11+1))+11
      : Math.floor(Math.random()*(10-3+1))+3;
    if (!sortedTotals.includes(val)) sortedTotals.push(val);
  }

  // Lấy 3 giá trị dự đoán Vi gần nhất
  return sortedTotals.slice(0,3);
}

// Thuật toán dự đoán nâng cao VIP
function advancedPredictVIP(history) {
  const lastPattern = history.slice(-MAX_PATTERN);
  const last5 = history.slice(-5);
  let scoreTai = 0;
  let scoreXiu = 0;

  if (last5.length >= 3) {
    const last3 = last5.slice(-3);
    const countTai = last3.filter(h => h.Ket_qua === "Tài").length;
    const countXiu = last3.filter(h => h.Ket_qua === "Xỉu").length;
    if (countTai >= 2) scoreTai += 0.3;
    if (countXiu >= 2) scoreXiu += 0.3;
  }

  if (last5.length >= 1) {
    const lastPhien = last5[last5.length - 1];
    if (lastPhien.Ket_qua === "Tài") scoreXiu += 0.2;
    else scoreTai += 0.2;
  }

  if (last5.length >= 1) {
    const lastPhien = last5[last5.length - 1];
    if (lastPhien.Tong >= 11) scoreTai += 0.3;
    else scoreXiu += 0.3;
  }

  const totalTai = lastPattern.filter(h => h.Ket_qua === "Tài").length;
  const totalXiu = lastPattern.filter(h => h.Ket_qua === "Xỉu").length;
  const total = lastPattern.length || 1;
  if (totalTai / total > 0.6) scoreTai += 0.2;
  if (totalXiu / total > 0.6) scoreXiu += 0.2;

  const lastWrong = last5.filter(h => h.Du_doan && h.Du_doan !== h.Ket_qua).length;
  if (lastWrong >= RESET_THRESHOLD) {
    scoreTai = 0.5;
    scoreXiu = 0.5;
  }

  const totalScore = scoreTai + scoreXiu || 1;
  const probTai = (scoreTai / totalScore) * 100;
  const probXiu = (scoreXiu / totalScore) * 100;

  const duDoan = probTai > probXiu ? "Tài" : "Xỉu";
  const doTinCay = Math.max(probTai, probXiu).toFixed(0);
  const loaiCau = detectCau(history);
  const Vi = predictViVIP(history, duDoan);

  return { duDoan, doTinCay, loaiCau, Vi };
}

// API chính
app.get("/api", async (req, res) => {
  try {
    const data = await fetchWithRetry(SOURCE_API);

    if (data.Phien !== lastPhien) {
      lastPhien = data.Phien;
      const { duDoan, doTinCay, loaiCau, Vi } = advancedPredictVIP(history);

      const newEntry = {
        Phien: data.Phien,
        Xuc_xac: data.Xuc_xac,
        Tong: data.Tong,
        Ket_qua: data.Ket_qua,
        Du_doan: duDoan,
        Loai_cau: loaiCau,
        Vi: Vi,
        Do_tin_cay: `${doTinCay}%`
      };

      history.push(newEntry);
      saveData();
    }

    const soDung = history.filter(h => h.Du_doan === h.Ket_qua).length;
    const soSai = history.length - soDung;
    const tiLeChinhXac = history.length > 0 ? ((soDung / history.length) * 100).toFixed(1) + "%" : "0%";

    const output = {
      Phien: history.map(h => ({
        Phien: h.Phien,
        Xuc_xac: h.Xuc_xac,
        Tong: h.Tong,
        Ket_qua: h.Ket_qua,
        Du_doan: h.Du_doan,
        Loai_cau: h.Loai_cau,
        Vi: h.Vi,
        Do_tin_cay: h.Do_tin_cay
      })),
      Tong_so_phien: history.length,
      So_dung: soDung,
      So_sai: soSai,
      Ti_le_chinh_xac: tiLeChinhXac,
      Dev: "@minhsangdangcap"
    };

    res.json(output);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Lỗi server hoặc không lấy được dữ liệu." });
  }
});

setInterval(async () => {
  try {
    await fetchWithRetry(SOURCE_API);
  } catch {}
}, 3000);

app.listen(PORT, () => console.log(`Server chạy cổng ${PORT}`));
