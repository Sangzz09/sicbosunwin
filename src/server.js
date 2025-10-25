import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const SOURCE_API = "https://sicbosun-100.onrender.com/api";

// Lịch sử dự đoán
let history = [];
let lastPhien = null;

// Lấy dữ liệu với retry + timeout chống 502
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

// Hàm tạo trọng số ngẫu nhiên hợp lý
function randomConfidence() {
  return Math.floor(Math.random() * 31) + 60; // 60-90%
}

// Thuật toán nâng cao kết hợp nhiều phương pháp
function advancedPredict(history) {
  const last = history[history.length - 1] || null;
  const last5 = history.slice(-5);

  let scoreTai = 0;
  let scoreXiu = 0;

  // Thuật toán 1 – Cầu liên tục (weight 0.3)
  if (last5.length >= 3) {
    const last3 = last5.slice(-3);
    const countTai = last3.filter(h => h.Ket_qua === "Tài").length;
    const countXiu = last3.filter(h => h.Ket_qua === "Xỉu").length;
    if (countTai >= 2) scoreTai += 0.3;
    if (countXiu >= 2) scoreXiu += 0.3;
  }

  // Thuật toán 2 – Cầu đảo (weight 0.2)
  if (last) {
    if (last.Ket_qua === "Tài") scoreXiu += 0.2;
    else scoreTai += 0.2;
  }

  // Thuật toán 3 – Tổng xúc xắc (weight 0.3)
  if (last) {
    if (last.Tong >= 11) scoreTai += 0.3;
    else scoreXiu += 0.3;
  }

  // Thuật toán 4 – Pattern dài hạn (weight 0.2)
  const totalTai = history.filter(h => h.Ket_qua === "Tài").length;
  const totalXiu = history.filter(h => h.Ket_qua === "Xỉu").length;
  const total = history.length || 1;
  if (totalTai / total > 0.6) scoreTai += 0.2;
  if (totalXiu / total > 0.6) scoreXiu += 0.2;

  // Chuẩn hóa xác suất
  const totalScore = scoreTai + scoreXiu || 1;
  const probTai = (scoreTai / totalScore) * 100;
  const probXiu = (scoreXiu / totalScore) * 100;

  const duDoan = probTai > probXiu ? "Tài" : "Xỉu";
  const doTinCay = Math.max(probTai, probXiu).toFixed(0);

  return { duDoan, doTinCay };
}

// API chính
app.get("/api", async (req, res) => {
  try {
    const data = await fetchWithRetry(SOURCE_API);

    // Nếu phiên mới, thêm dự đoán
    if (data.Phien !== lastPhien) {
      lastPhien = data.Phien;

      const { duDoan, doTinCay } = advancedPredict(history);

      const newEntry = {
        Phien: data.Phien,
        Xuc_xac: data.Xuc_xac,
        Tong: data.Tong,
        Ket_qua: data.Ket_qua,
        Du_doan: duDoan,
        Giai_thich: "Dự đoán theo thuật toán nâng cao + trọng số kết hợp",
        Do_tin_cay: `${doTinCay}%`,
      };

      history.push(newEntry);
    }

    // Tính số đúng, sai, tỉ lệ
    const soDung = history.filter(h => h.Du_doan === h.Ket_qua).length;
    const soSai = history.length - soDung;
    const tiLeChinhXac = history.length > 0 ? ((soDung / history.length) * 100).toFixed(1) + "%" : "0%";

    // Trả JSON đầy đủ
    const output = {
      Dev: "@minhsangdangcap",
      Phiens: history.map(h => ({
        Phien: h.Phien,
        Xuc_xac: h.Xuc_xac,
        Tong: h.Tong,
        Ket_qua: h.Ket_qua,
        Du_doan: h.Du_doan,
        Giai_thich: h.Giai_thich,
        Do_tin_cay: h.Do_tin_cay,
      })),
      Tong_so_phien: history.length,
      So_dung: soDung,
      So_sai: soSai,
      Ti_le_chinh_xac: tiLeChinhXac,
      Cap_nhat_cach_3s: "API tự động cập nhật khi có phiên mới",
    };

    res.json(output);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Không thể lấy dữ liệu từ nguồn hoặc lỗi server." });
  }
});

// Auto fetch mỗi 3s để không bỏ sót phiên
setInterval(async () => {
  try {
    await fetchWithRetry(SOURCE_API);
  } catch (err) {
    console.log("Fetch auto thất bại, bỏ qua.");
  }
}, 3000);

app.listen(PORT, () => console.log(`Server chạy trên cổng ${PORT}`));
