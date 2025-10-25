/**
 * 🎲 Sicbo Sunwin API v8.3
 * - Thêm dự đoán vị (3 tổng điểm có khả năng cao nhất)
 * - Ẩn toàn bộ thuật toán trong JSON
 * - Auto reset khi sai nhiều (>=5 lần)
 * - Giữ thống kê tổng
 * - Phân tích loại cầu nâng cao
 * - Dev: @minhsangdangcap
 */

import express from "express";
import axios from "axios";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

// ================= CONFIG =================
const API_URL =
  "https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=20&tableId=39791215743193&curPage=1";
const UPDATE_INTERVAL = 15000;
const DATA_FILE = "./data.json";
const MAX_HISTORY = 50;
const MAX_WRONG_STREAK = 5;

// ================= STATE =================
let historyData = [];
let stats = { predicted: 0, correct: 0, wrong: 0, accuracy: "0%" };
let wrongStreak = 0;

// ================= HELPERS =================
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf-8");
try {
  historyData = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) || [];
  if (!Array.isArray(historyData)) historyData = [];
} catch {
  historyData = [];
}

function getTaiXiu(score) {
  if (score >= 4 && score <= 10) return "Xỉu";
  if (score >= 11 && score <= 17) return "Tài";
  return "N/A";
}

function saveData() {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(historyData.slice(0, MAX_HISTORY), null, 2),
    "utf-8"
  );
}

function updateStats() {
  const valid = historyData.filter(
    (h) => h.prediction && getTaiXiu(h.score) !== "N/A"
  );
  const correct = valid.filter((h) => getTaiXiu(h.score) === h.prediction);
  const wrong = valid.length - correct.length;
  const acc = valid.length
    ? ((correct.length / valid.length) * 100).toFixed(2) + "%"
    : "0%";
  stats = {
    predicted: valid.length,
    correct: correct.length,
    wrong,
    accuracy: acc,
  };
}

// ================= THUẬT TOÁN (ẨN) =================
function algoSimple(history) {
  const s = history.slice(0, 5);
  const t = s.filter((h) => getTaiXiu(h.score) === "Tài").length;
  return t >= 3 ? "Tài" : "Xỉu";
}

function algoMarkov(history) {
  const seq = history.map((h) => getTaiXiu(h.score));
  const trans = { Tài: { Tài: 0, Xỉu: 0 }, Xỉu: { Tài: 0, Xỉu: 0 } };
  for (let i = 0; i < seq.length - 1; i++) trans[seq[i]][seq[i + 1]]++;
  const curr = seq[0];
  if (!curr) return "N/A";
  const nextT = trans[curr]["Tài"];
  const nextX = trans[curr]["Xỉu"];
  return nextT > nextX ? "Tài" : "Xỉu";
}

function algoWeighted(history) {
  let score = 0;
  const N = Math.min(7, history.length);
  for (let i = 0; i < N; i++) {
    const w = (N - i) / N;
    score += (getTaiXiu(history[i].score) === "Tài" ? 1 : -1) * w;
  }
  return score > 0 ? "Tài" : "Xỉu";
}

function ensemblePredict(history) {
  const votes = { Tài: 0, Xỉu: 0 };
  const algos = [algoSimple, algoMarkov, algoWeighted];
  const weights = [1, 1.2, 1.3];
  for (let i = 0; i < algos.length; i++) {
    const pred = algos[i](history);
    if (pred !== "N/A") votes[pred] += weights[i];
  }
  const total = votes.Tài + votes.Xỉu;
  if (!total) return { prediction: "N/A", confidence: 0 };
  const final = votes.Tài > votes.Xỉu ? "Tài" : "Xỉu";
  const conf = ((Math.abs(votes.Tài - votes.Xỉu) / total) * 100 + 40).toFixed(
    2
  );
  return { prediction: final, confidence: conf };
}

// ================= LOẠI CẦU =================
function detectLoaiCau(history) {
  const seq = history.slice(0, 8).map((h) => getTaiXiu(h.score));
  if (seq.every((s) => s === "Tài")) return "Cầu Tài liên tục";
  if (seq.every((s) => s === "Xỉu")) return "Cầu Xỉu liên tục";
  if (seq.slice(0, 6).every((r, i, a) => i === 0 || r !== a[i - 1]))
    return "Cầu Đảo liên tục";
  if (seq[0] === seq[1] && seq[2] === seq[3] && seq[0] !== seq[2])
    return "Cầu 2-2";
  if (seq[0] === seq[1] && seq[2] !== seq[1]) return "Cầu 2-1";
  return "Cầu hỗn hợp";
}

// ================= DỰ ĐOÁN VỊ =================
function predictVi(history, mainPrediction) {
  const recent = history.slice(0, 25);
  const freq = {};
  for (const h of recent) freq[h.score] = (freq[h.score] || 0) + 1;

  // Sắp xếp theo tần suất
  const sorted = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => Number(k));

  // Ưu tiên theo hướng dự đoán
  const filter =
    mainPrediction === "Tài"
      ? sorted.filter((s) => s >= 11)
      : sorted.filter((s) => s <= 10);

  const vi = filter.slice(0, 3);
  while (vi.length < 3) {
    const val =
      mainPrediction === "Tài"
        ? Math.floor(Math.random() * 7) + 11
        : Math.floor(Math.random() * 7) + 4;
    if (!vi.includes(val)) vi.push(val);
  }
  return vi;
}

// ================= FETCH API =================
async function fetchLatestData() {
  try {
    const res = await axios.get(API_URL, { timeout: 10000 });
    return res?.data?.data?.resultList || [];
  } catch {
    return null;
  }
}

async function updateHistory() {
  const newData = await fetchLatestData();
  if (!newData) return;
  if (!historyData.length) {
    historyData = newData.map((x) => ({ ...x, ket_qua: getTaiXiu(x.score) }));
    saveData();
    updateStats();
    return;
  }

  const latest = historyData[0]?.gameNum;
  const idx = newData.findIndex((x) => x.gameNum === latest);
  if (idx > 0) {
    const newEntries = newData.slice(0, idx).map((x) => ({
      ...x,
      ket_qua: getTaiXiu(x.score),
    }));
    historyData.unshift(...newEntries);
    historyData = historyData.slice(0, MAX_HISTORY);
    saveData();
    updateStats();
  }
}

// ================= RESET KHI SAI NHIỀU =================
function checkResetLogic() {
  if (wrongStreak >= MAX_WRONG_STREAK) {
    console.log("⚠️ Sai liên tiếp quá nhiều, reset dữ liệu lịch sử...");
    historyData = historyData.slice(0, 5);
    wrongStreak = 0;
    saveData();
  }
}

// ================= API =================
app.get("/", (req, res) => {
  res.json({
    message: "🎲 Sicbo Sunwin API v8.3",
    endpoints: ["/sicbosun/latest", "/api/sunwin/history"],
    Dev: "@minhsangdangcap",
  });
});

app.get("/sicbosun/latest", (req, res) => {
  if (!historyData.length) return res.json({ error: "Đang tải dữ liệu..." });

  const latest = historyData[0];
  const nextPhien = Number(latest.gameNum.replace("#", "")) + 1;

  const predict = ensemblePredict(historyData);
  const loaiCau = detectLoaiCau(historyData);
  const viDuDoan = predictVi(historyData, predict.prediction);

  if (predict.prediction && predict.prediction !== "N/A") {
    historyData[0].prediction = predict.prediction;

    const actual = getTaiXiu(latest.score);
    if (actual !== "N/A" && predict.prediction) {
      if (actual === predict.prediction) wrongStreak = 0;
      else wrongStreak++;
    }

    checkResetLogic();
    saveData();
    updateStats();
  }

  res.json({
    phien: latest.gameNum,
    tong_diem: latest.score,
    ket_qua: getTaiXiu(latest.score),
    phien_tiep_theo: `#${nextPhien}`,
    du_doan: predict.prediction,
    do_tin_cay: `${predict.confidence}%`,
    loai_cau: loaiCau,
    vi_du_doan: viDuDoan,
    thong_ke: {
      so_phien_du_doan: stats.predicted,
      so_dung: stats.correct,
      so_sai: stats.wrong,
      ti_le_dung: stats.accuracy,
    },
    Dev: "@minhsangdangcap",
  });
});

app.get("/api/sunwin/history", (req, res) => {
  updateStats();
  res.json({
    thong_ke: stats,
    data: historyData,
    Dev: "@minhsangdangcap",
  });
});

// ================= START SERVER =================
app.listen(PORT, () => {
  console.log(`🚀 Server chạy tại http://localhost:${PORT}`);
  updateHistory();
  setInterval(updateHistory, UPDATE_INTERVAL);
});
