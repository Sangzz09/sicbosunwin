import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import fs from "fs";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const SOURCE_API = "https://sicsunnehahahaha.onrender.com/predict";

let history = [];
let lastPhien = null;

// Load data.json nếu có
if (fs.existsSync("data.json")) {
  try {
    history = JSON.parse(fs.readFileSync("data.json"));
    if (history.length > 0) lastPhien = history[history.length - 1].Phien;
  } catch {
    history = [];
  }
}

// Lưu lịch sử
function saveData() {
  fs.writeFileSync("data.json", JSON.stringify(history, null, 2));
}

// Fetch API với retry
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

// Dự đoán Vi tự động dựa trên tổng gần nhất
function predictVi(history, duDoan) {
  const lastTotals = history.slice(-20).map(h => h.Tong);
  const freq = {};
  lastTotals.forEach(t => freq[t] = (freq[t] || 0) + 1);

  let sortedTotals = Object.keys(freq).map(Number).sort((a,b) => freq[b]-freq[a]);

  // Nếu chưa đủ 3 giá trị, thêm ngẫu nhiên theo Tài/Xỉu
  while (sortedTotals.length < 3) {
    const val = duDoan === "Tài"
      ? Math.floor(Math.random()*(18-11+1))+11
      : Math.floor(Math.random()*(10-3+1))+3;
    if (!sortedTotals.includes(val)) sortedTotals.push(val);
  }

  return sortedTotals.slice(0,3);
}

// Thuật toán dự đoán Tài/Xỉu VIP
function advancedPredict(history) {
  const last5 = history.slice(-5);
  let scoreTai = 0, scoreXiu = 0;

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
    if (lastPhien.Tong >= 11) scoreTai += 0.3;
    else scoreXiu += 0.3;
  }

  const totalTai = last5.filter(h => h.Ket_qua === "Tài").length;
  const totalXiu = last5.filter(h => h.Ket_qua === "Xỉu").length;
  const total = last5.length || 1;
  if (totalTai / total > 0.6) scoreTai += 0.2;
  if (totalXiu / total > 0.6) scoreXiu += 0.2;

  const lastWrong = last5.filter(h => h.Du_doan && h.Du_doan !== h.Ket_qua).length;
  const RESET_THRESHOLD = 5;
  if (lastWrong >= RESET_THRESHOLD) {
    scoreTai = 0.5;
    scoreXiu = 0.5;
  }

  const totalScore = scoreTai + scoreXiu || 1;
  const probTai = (scoreTai / totalScore) * 100;
  const probXiu = (scoreXiu / totalScore) * 100;

  const duDoan = probTai > probXiu ? "Tài" : "Xỉu";
  const doTinCay = Math.max(probTai, probXiu).toFixed(2);

  const Vi = predictVi(history, duDoan);
  const loaiCau = detectCau(history);

  return { duDoan, doTinCay, Vi, loaiCau };
}

// API chính
app.get("/api", async (req, res) => {
  try {
    const data = await fetchWithRetry(SOURCE_API);

    const Phien = Number(data["🎯 Phiên Dự Đoán"]);
    const Xuc_xac = data["🎲 Xúc Xắc"].split(" - ").map(Number);
    const Tong = Number(data["📈 Tổng Điểm"]);
    const Ket_qua = data["📊 Kết Quả"];

    // Chỉ thêm phiên mới
    if (Phien !== lastPhien) {
      lastPhien = Phien;
      const { duDoan, doTinCay, Vi, loaiCau } = advancedPredict(history);

      const newEntry = {
        Phien,
        Xuc_xac,
        Tong,
        Ket_qua,
        Du_doan: duDoan,
        Loai_cau: loaiCau,
        Vi,
        Do_tin_cay: `${doTinCay}%`
      };

      history.push(newEntry);
      saveData();
    }

    const soDung = history.filter(h => h.Du_doan === h.Ket_qua).length;
    const soSai = history.length - soDung;
    const tiLeChinhXac = history.length > 0 ? ((soDung / history.length) * 100).toFixed(2) + "%" : "0%";

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

// Auto fetch mỗi 3s
setInterval(async () => {
  try {
    await fetchWithRetry(SOURCE_API);
  } catch {}
}, 3000);

app.listen(PORT, () => console.log(`Server chạy cổng ${PORT}`));
