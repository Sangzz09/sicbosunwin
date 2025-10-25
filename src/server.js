/**
 * Sicbo Sunwin API v7.0
 * - Multiple prediction algorithms
 * - Ensemble voting with weights
 * - Many "loại cầu" detectors
 * - Endpoints: /sicbosun/latest, /api/sunwin/history, /algorithms
 *
 * Usage: node server.js
 */

import express from "express";
import axios from "axios";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

// === Config ===
const API_URL =
  "https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=20&tableId=39791215743193&curPage=1";
const UPDATE_INTERVAL = 15000; // 15s
const DATA_FILE = "./data.json";
const MAX_HISTORY = 50;

// === State ===
let historyData = [];
let stats = { predicted: 0, correct: 0, wrong: 0, accuracy: "0%" };

// === Init file ===
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf-8");
try {
  historyData = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) || [];
  if (!Array.isArray(historyData)) historyData = [];
} catch {
  historyData = [];
}

// === Utils ===
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

// === Data fetching & updating ===
async function fetchLatestData() {
  try {
    const res = await axios.get(API_URL, { timeout: 10000 });
    return res?.data?.data?.resultList || [];
  } catch (err) {
    console.error("⚠️ Lỗi fetch API:", err.message);
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
    console.log(`🆕 Tải ban đầu ${historyData.length} phiên.`);
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
    console.log(`✅ Cập nhật ${newEntries.length} phiên.`);
  }
}

// === Prediction algorithms ===
// All algorithms return { prediction: "Tài"|"Xỉu"|"N/A", confidence: number 0-100, meta?: {} }

// 1) Simple Majority (last N)
function algoSimpleMajority(history, N = 5) {
  const slice = history.slice(0, N);
  const tai = slice.filter(h => getTaiXiu(h.score) === "Tài").length;
  const xiu = slice.length - tai;
  const pred = tai > xiu ? "Tài" : xiu > tai ? "Xỉu" : getTaiXiu(history[0]?.score || 11);
  const conf = (Math.abs(tai - xiu) / N) * 60 + 40; // 40-100
  return { prediction: pred, confidence: Number(conf.toFixed(2)), meta: { algo: "SimpleMajority", N } };
}

// 2) Weighted Recency (more weight to recent)
function algoWeightedRecency(history, N = 7) {
  const slice = history.slice(0, N);
  let score = 0;
  for (let i = 0; i < slice.length; i++) {
    const w = (N - i) / N; // recent has larger weight
    score += (getTaiXiu(slice[i].score) === "Tài" ? 1 : -1) * w;
  }
  const pred = score > 0 ? "Tài" : score < 0 ? "Xỉu" : getTaiXiu(history[0]?.score || 11);
  const conf = Math.min(95, Math.abs(score) / N * 120);
  return { prediction: pred, confidence: Number(conf.toFixed(2)), meta: { algo: "WeightedRecency", N } };
}

// 3) Moving Average of totals (sum tendencies)
function algoMovingAverage(history, N = 6) {
  const slice = history.slice(0, N);
  const avg = slice.reduce((s, h) => s + (h.score || 0), 0) / (slice.length || 1);
  const pred = avg >= 11 ? "Tài" : "Xỉu";
  const variance = slice.reduce((s, h) => s + Math.pow((h.score || 0) - avg, 2), 0) / (slice.length || 1);
  const conf = Math.max(40, Math.min(95, (Math.abs(avg - 10.5) / 6) * 100)); // more away from center => higher conf
  return { prediction: pred, confidence: Number(conf.toFixed(2)), meta: { algo: "MovingAverage", avg: Number(avg.toFixed(2)), variance: Number(variance.toFixed(2)) } };
}

// 4) Pattern n-gram (look for repeating last-k patterns in history)
function algoPatternMatch(history, k = 3) {
  if (history.length < k + 1) return { prediction: "N/A", confidence: 0, meta: { algo: "PatternMatch" } };
  const seq = history.map(h => getTaiXiu(h.score));
  const lastK = seq.slice(0, k).join(",");
  // search for occurrences of lastK followed by something
  let followCounts = { Tài: 0, Xỉu: 0 };
  for (let i = 0; i < seq.length - k; i++) {
    if (seq.slice(i, i + k).join(",") === lastK) {
      const next = seq[i + k];
      if (next === "Tài") followCounts["Tài"]++;
      if (next === "Xỉu") followCounts["Xỉu"]++;
    }
  }
  const total = followCounts["Tài"] + followCounts["Xỉu"];
  if (total === 0) return { prediction: "N/A", confidence: 0, meta: { algo: "PatternMatch" } };
  const pred = followCounts["Tài"] > followCounts["Xỉu"] ? "Tài" : "Xỉu";
  const conf = Math.min(98, (Math.abs(followCounts["Tài"] - followCounts["Xỉu"]) / total) * 100 + 50);
  return { prediction: pred, confidence: Number(conf.toFixed(2)), meta: { algo: "PatternMatch", lastK, followCounts } };
}

// 5) Markov 1-step (transition probabilities)
function algoMarkov(history) {
  if (history.length < 5) return { prediction: "N/A", confidence: 0, meta: { algo: "Markov" } };
  const seq = history.map(h => getTaiXiu(h.score));
  // transitions A->B counts
  const trans = { "Tài": { "Tài": 0, "Xỉu": 0 }, "Xỉu": { "Tài": 0, "Xỉu": 0 } };
  for (let i = 0; i < seq.length - 1; i++) {
    const a = seq[i], b = seq[i + 1];
    if (a && b) trans[a][b] = (trans[a][b] || 0) + 1;
  }
  const current = seq[0];
  if (!current) return { prediction: "N/A", confidence: 0, meta: { algo: "Markov" } };
  const nextT = trans[current]["Tài"] || 0;
  const nextX = trans[current]["Xỉu"] || 0;
  const total = nextT + nextX;
  if (total === 0) return { prediction: "N/A", confidence: 0, meta: { algo: "Markov" } };
  const pred = nextT > nextX ? "Tài" : "Xỉu";
  const conf = Math.min(95, (Math.abs(nextT - nextX) / total) * 100 + 40);
  return { prediction: pred, confidence: Number(conf.toFixed(2)), meta: { algo: "Markov", current, nextT, nextX } };
}

// 6) Frequency based (most frequent totals -> map to Tài/Xỉu)
function algoFrequencyTotals(history, window = 15) {
  const slice = history.slice(0, window);
  const freq = {};
  slice.forEach(h => (freq[h.score] = (freq[h.score] || 0) + 1));
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return { prediction: "N/A", confidence: 0, meta: { algo: "FreqTotals" } };
  const top = Number(sorted[0][0]);
  const pred = getTaiXiu(top);
  const conf = Math.min(90, (sorted[0][1] / slice.length) * 100 + 30);
  return { prediction: pred, confidence: Number(conf.toFixed(2)), meta: { algo: "FreqTotals", top } };
}

// 7) Streak detector (if there's a long streak -> continue)
function algoStreakDetector(history, minStreak = 3) {
  if (history.length < minStreak) return { prediction: "N/A", confidence: 0, meta: { algo: "Streak" } };
  const seq = history.map(h => getTaiXiu(h.score));
  let streakVal = seq[0];
  let streakLen = 1;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] === streakVal) streakLen++; else break;
  }
  if (streakLen >= minStreak) {
    const conf = Math.min(99, 50 + streakLen * 12); // longer streak -> higher conf
    return { prediction: streakVal, confidence: Number(conf.toFixed(2)), meta: { algo: "Streak", streakLen } };
  }
  return { prediction: "N/A", confidence: 0, meta: { algo: "Streak" } };
}

// List of algos and their default weights for ensemble
const ALGORITHMS = [
  { fn: algoSimpleMajority, weight: 1.0, name: "SimpleMajority" },
  { fn: algoWeightedRecency, weight: 1.2, name: "WeightedRecency" },
  { fn: algoMovingAverage, weight: 0.9, name: "MovingAverage" },
  { fn: algoPatternMatch, weight: 1.5, name: "PatternMatch" },
  { fn: algoMarkov, weight: 1.3, name: "Markov" },
  { fn: algoFrequencyTotals, weight: 0.8, name: "FreqTotals" },
  { fn: algoStreakDetector, weight: 1.4, name: "Streak" },
];

// Ensemble: weighted voting by confidence*weight
function ensemblePredict(history) {
  const votes = { "Tài": 0, "Xỉu": 0 };
  const details = [];
  for (const a of ALGORITHMS) {
    try {
      const out = a.fn(history);
      const pred = out.prediction;
      const conf = Math.max(0, Math.min(100, Number(out.confidence || 0)));
      // normalize N/A to skip
      if (!pred || pred === "N/A") {
        details.push({ algo: a.name, prediction: "N/A", confidence: conf, weight: a.weight });
        continue;
      }
      const power = (conf / 100) * a.weight;
      votes[pred] = (votes[pred] || 0) + power;
      details.push({ algo: a.name, prediction: pred, confidence: conf, weight: a.weight, power: Number(power.toFixed(3)), meta: out.meta || {} });
    } catch (e) {
      details.push({ algo: a.name, error: e.message });
    }
  }
  const totalPower = (votes["Tài"] || 0) + (votes["Xỉu"] || 0);
  if (totalPower === 0) return { prediction: "N/A", confidence: 0, details };
  const finalPred = (votes["Tài"] || 0) > (votes["Xỉu"] || 0) ? "Tài" : "Xỉu";
  const confPercent = Math.min(99, Math.abs((votes["Tài"] || 0) - (votes["Xỉu"] || 0)) / totalPower * 100 + 40);
  return { prediction: finalPred, confidence: Number(confPercent.toFixed(2)), details };
}

// === Loại cầu nâng cao ===
function detectLoaiCau(history) {
  if (history.length < 6) return "Chưa đủ dữ liệu";
  const seq = history.slice(0, 8).map(h => getTaiXiu(h.score)); // consider up to 8 recent
  // Basic repeated patterns
  if (seq.every(s => s === "Tài")) return "Cầu Tài liên tục";
  if (seq.every(s => s === "Xỉu")) return "Cầu Xỉu liên tục";
  if (seq.slice(0, 6).every((r, i, a) => i === 0 || r !== a[i - 1])) return "Cầu Đảo liên tục";
  // 3 đầu
  if (seq[0] && seq[1] && seq[2] && seq[0] === seq[1] && seq[1] === seq[2]) return "Cầu 3 đầu";
  // 2-2
  if (seq[0] === seq[1] && seq[2] === seq[3] && seq[0] !== seq[2]) return "Cầu 2-2";
  // 2-1 pattern (two same then different)
  if (seq[0] === seq[1] && seq[2] !== seq[1]) return "Cầu 2-1";
  // Markov-ish frequent transition
  const trans = {};
  const mapped = history.map(h => getTaiXiu(h.score));
  for (let i = 0; i < mapped.length - 1; i++) {
    const a = mapped[i], b = mapped[i + 1];
    trans[a] = trans[a] || {};
    trans[a][b] = (trans[a][b] || 0) + 1;
  }
  // check if certain transition dominates
  if (trans["Tài"] && trans["Tài"]["Tài"] && trans["Tài"]["Tài"] > (trans["Tài"]["Xỉu"] || 0) + 1) return "Cầu Markov: Tài→Tài ưu thế";
  if (trans["Xỉu"] && trans["Xỉu"]["Xỉu"] && trans["Xỉu"]["Xỉu"] > (trans["Xỉu"]["Tài"] || 0) + 1) return "Cầu Markov: Xỉu→Xỉu ưu thế";
  // frequency based
  const freq = {};
  history.slice(0, 15).forEach(h => (freq[h.score] = (freq[h.score] || 0) + 1));
  const topScore = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
  if (topScore && topScore[1] >= 3) {
    const topTaiXiu = getTaiXiu(Number(topScore[0]));
    return `Cầu tần suất: ${topScore[0]} (${topTaiXiu}) hay xuất hiện`;
  }
  return "Cầu hỗn hợp";
}

// === API endpoints ===
app.get("/", (req, res) => {
  res.json({
    message: "🎲 Sicbo Sunwin API v7.0",
    endpoints: [
      { path: "/sicbosun/latest", desc: "Phiên mới nhất + dự đoán (ensemble)" },
      { path: "/api/sunwin/history", desc: "Lịch sử + thống kê" },
      { path: "/algorithms", desc: "Danh sách thuật toán và weights" },
    ],
    Dev: "@minhsangdangcap"
  });
});

// sicbosun/latest
app.get("/sicbosun/latest", (req, res) => {
  if (historyData.length === 0) return res.status(503).json({ error: "Dữ liệu đang tải..." });
  const latest = historyData[0];
  const nextPhien = Number(latest.gameNum.replace("#", "")) + 1;
  // run ensemble
  const ensemble = ensemblePredict(historyData);
  const loaiCau = detectLoaiCau(historyData);
  // attach prediction to latest for tracking
  if (ensemble.prediction && ensemble.prediction !== "N/A") latest.prediction = ensemble.prediction;
  saveData();
  updateStats();
  res.json({
    phien: latest.gameNum,
    xuc_xac: latest.facesList || [],
    tong_diem: latest.score || 0,
    ket_qua: getTaiXiu(latest.score),
    phien_tiep_theo: `#${nextPhien}`,
    du_doan: ensemble.prediction,
    do_tin_cay: `${ensemble.confidence}%`,
    loai_cau: loaiCau,
    thong_ke: {
      so_phien_du_doan: stats.predicted,
      so_dung: stats.correct,
      so_sai: stats.wrong,
      ti_le_dung: stats.accuracy
    },
    ensemble_details: ensemble.details || [],
    Dev: "@minhsangdangcap"
  });
});

// history
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

// algorithms listing
app.get("/algorithms", (req, res) => {
  res.json({
    algorithms: ALGORITHMS.map(a => ({ name: a.name, weight: a.weight })),
    note: "Mỗi thuật toán trả về prediction + confidence; ensemble cân bằng theo weight * confidence."
  });
});

// start server
app.listen(PORT, () => {
  console.log(`🚀 Server chạy tại http://localhost:${PORT}`);
  updateHistory();
  setInterval(updateHistory, UPDATE_INTERVAL);
});
