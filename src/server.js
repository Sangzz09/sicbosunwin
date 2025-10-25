/**
 * Sicbo Sunwin API v7.1
 * - Ẩn chi tiết các thuật toán khỏi JSON
 * - Nhiều loại cầu & thuật toán kết hợp
 * - Hiển thị thống kê tổng hợp ngắn gọn
 * - Dev: @minhsangdangcap
 */

import express from "express";
import axios from "axios";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

const API_URL =
  "https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=20&tableId=39791215743193&curPage=1";
const UPDATE_INTERVAL = 15000;
const DATA_FILE = "./data.json";
const MAX_HISTORY = 50;

let historyData = [];
let stats = { predicted: 0, correct: 0, wrong: 0, accuracy: "0%" };

// --- Load dữ liệu ban đầu ---
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf-8");
try {
  historyData = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) || [];
  if (!Array.isArray(historyData)) historyData = [];
} catch {
  historyData = [];
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(historyData.slice(0, MAX_HISTORY), null, 2), "utf-8");
}

function getTaiXiu(score) {
  if (score >= 4 && score <= 10) return "Xỉu";
  if (score >= 11 && score <= 17) return "Tài";
  return "N/A";
}

function updateStats() {
  const predicted = historyData.filter(h => h.prediction);
  const correct = predicted.filter(h => getTaiXiu(h.score) === h.prediction);
  const wrong = predicted.length - correct.length;
  const acc = predicted.length ? ((correct.length / predicted.length) * 100).toFixed(2) + "%" : "0%";
  stats = { predicted: predicted.length, correct: correct.length, wrong, accuracy: acc };
}

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

  if (historyData.length === 0) {
    historyData = newData.map(x => ({ ...x, ket_qua: getTaiXiu(x.score) }));
    historyData = historyData.slice(0, MAX_HISTORY);
    saveData();
    updateStats();
    console.log(`🆕 Khởi tạo ${historyData.length} phiên.`);
    return;
  }

  const latestKnown = historyData[0]?.gameNum;
  const idx = newData.findIndex(x => x.gameNum === latestKnown);
  if (idx > 0) {
    const newEntries = newData.slice(0, idx).map(x => ({ ...x, ket_qua: getTaiXiu(x.score) }));
    historyData.unshift(...newEntries);
    historyData = historyData.slice(0, MAX_HISTORY);
    saveData();
    updateStats();
    console.log(`✅ Cập nhật ${newEntries.length} phiên mới.`);
  }
}

// --- Các thuật toán dự đoán chính ---
function algoMajority(history, N = 5) {
  const slice = history.slice(0, N);
  const tai = slice.filter(h => getTaiXiu(h.score) === "Tài").length;
  const xiu = N - tai;
  const pred = tai > xiu ? "Tài" : xiu > tai ? "Xỉu" : getTaiXiu(history[0].score);
  const conf = Math.abs(tai - xiu) / N * 100;
  return { prediction: pred, confidence: Number(conf.toFixed(2)) };
}

function algoWeighted(history, N = 7) {
  let score = 0;
  for (let i = 0; i < N && i < history.length; i++) {
    const w = (N - i) / N;
    score += (getTaiXiu(history[i].score) === "Tài" ? 1 : -1) * w;
  }
  const pred = score > 0 ? "Tài" : "Xỉu";
  const conf = Math.min(95, Math.abs(score) / N * 120);
  return { prediction: pred, confidence: Number(conf.toFixed(2)) };
}

function algoPattern(history, k = 3) {
  const seq = history.map(h => getTaiXiu(h.score));
  if (seq.length < k + 1) return { prediction: "N/A", confidence: 0 };
  const lastK = seq.slice(0, k).join(",");
  let counts = { Tài: 0, Xỉu: 0 };
  for (let i = 0; i < seq.length - k; i++) {
    if (seq.slice(i, i + k).join(",") === lastK) counts[seq[i + k]]++;
  }
  const total = counts["Tài"] + counts["Xỉu"];
  if (total === 0) return { prediction: "N/A", confidence: 0 };
  const pred = counts["Tài"] > counts["Xỉu"] ? "Tài" : "Xỉu";
  const conf = Math.min(99, (Math.abs(counts["Tài"] - counts["Xỉu"]) / total) * 100);
  return { prediction: pred, confidence: Number(conf.toFixed(2)) };
}

function algoMarkov(history) {
  if (history.length < 5) return { prediction: "N/A", confidence: 0 };
  const seq = history.map(h => getTaiXiu(h.score));
  const trans = { "Tài": { "Tài": 0, "Xỉu": 0 }, "Xỉu": { "Tài": 0, "Xỉu": 0 } };
  for (let i = 0; i < seq.length - 1; i++) trans[seq[i]][seq[i + 1]]++;
  const cur = seq[0];
  const nextT = trans[cur]["Tài"], nextX = trans[cur]["Xỉu"];
  const total = nextT + nextX;
  if (total === 0) return { prediction: "N/A", confidence: 0 };
  const pred = nextT > nextX ? "Tài" : "Xỉu";
  const conf = (Math.abs(nextT - nextX) / total) * 100;
  return { prediction: pred, confidence: Number(conf.toFixed(2)) };
}

function ensemble(history) {
  const algos = [algoMajority, algoWeighted, algoPattern, algoMarkov];
  const votes = { Tài: 0, Xỉu: 0 };
  for (const fn of algos) {
    const { prediction, confidence } = fn(history);
    if (prediction === "Tài" || prediction === "Xỉu")
      votes[prediction] += confidence;
  }
  const total = votes["Tài"] + votes["Xỉu"];
  if (total === 0) return { prediction: "N/A", confidence: 0 };
  const pred = votes["Tài"] > votes["Xỉu"] ? "Tài" : "Xỉu";
  const conf = Math.min(99, Math.abs(votes["Tài"] - votes["Xỉu"]) / total * 100 + 40);
  return { prediction: pred, confidence: Number(conf.toFixed(2)) };
}

// --- Loại cầu ---
function detectLoaiCau(history) {
  if (history.length < 6) return "Chưa đủ dữ liệu";
  const seq = history.slice(0, 8).map(h => getTaiXiu(h.score));
  if (seq.every(s => s === "Tài")) return "Cầu Tài liên tục";
  if (seq.every(s => s === "Xỉu")) return "Cầu Xỉu liên tục";
  if (seq.slice(0, 6).every((s, i, a) => i === 0 || s !== a[i - 1])) return "Cầu Đảo";
  if (seq[0] === seq[1] && seq[2] === seq[3] && seq[0] !== seq[2]) return "Cầu 2-2";
  if (seq[0] === seq[1] && seq[2] !== seq[1]) return "Cầu 2-1";
  return "Cầu hỗn hợp";
}

// --- API ---
app.get("/", (req, res) => {
  res.json({
    message: "🎲 Sicbo Sunwin API v7.1",
    endpoints: [
      "/sicbosun/latest",
      "/api/sunwin/history"
    ],
    Dev: "@minhsangdangcap"
  });
});

app.get("/sicbosun/latest", (req, res) => {
  if (historyData.length === 0) return res.status(503).json({ error: "Đang tải dữ liệu..." });

  const latest = historyData[0];
  const nextPhien = Number(latest.gameNum.replace("#", "")) + 1;

  const result = ensemble(historyData);
  const loaiCau = detectLoaiCau(historyData);

  if (result.prediction && result.prediction !== "N/A")
    latest.prediction = result.prediction;

  saveData();
  updateStats();

  res.json({
    phien: latest.gameNum,
    tong_diem: latest.score,
    ket_qua: getTaiXiu(latest.score),
    phien_tiep_theo: `#${nextPhien}`,
    du_doan: result.prediction,
    do_tin_cay: `${result.confidence}%`,
    loai_cau: loaiCau,
    thong_ke: {
      so_phien_du_doan: stats.predicted,
      so_dung: stats.correct,
      so_sai: stats.wrong,
      ti_le_dung: stats.accuracy
    },
    Dev: "@minhsangdangcap"
  });
});

app.get("/api/sunwin/history", (req, res) => {
  updateStats();
  res.json({
    so_phien_du_doan: stats.predicted,
    so_dung: stats.correct,
    so_sai: stats.wrong,
    ti_le_dung: stats.accuracy,
    data: historyData,
    Dev: "@minhsangdangcap"
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server chạy tại http://localhost:${PORT}`);
  updateHistory();
  setInterval(updateHistory, UPDATE_INTERVAL);
});
