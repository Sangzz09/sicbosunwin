// =======================================================
// SICBO SUNWIN PREDICTOR VIP v12.0 No-Key (Full)
// Dev: @minhsangdangcap - AI Enhanced v12 (No API KEY)
// Chạy: npm install && npm start
// =======================================================

import express from "express";
import axios from "axios";
import fs from "fs";
import http from "http";
import { WebSocketServer } from "ws";
import helmet from "helmet";
import cors from "cors";

// -------------------------
// Config
// -------------------------
const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || "./data.json";
const API_URL = process.env.API_URL ||
  "https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=100&tableId=39791215743193&curPage=1";
const UPDATE_INTERVAL = Number(process.env.UPDATE_INTERVAL_MS || 7000);
const MAX_HISTORY = Number(process.env.MAX_HISTORY || 2000);

// -------------------------
// Initial store
// -------------------------
let store = {
  history: [],
  predictions: [],
  stats: {
    total: 0,
    correct: 0,
    wrong: 0,
    accuracy: "0%",
    currentWinStreak: 0,
    maxWinStreak: 0
  },
  wrongStreak: 0
};

// -------------------------
// Helpers: load / save
// -------------------------
function loadStore() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
    } else {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        store.history = parsed.history || store.history;
        store.predictions = parsed.predictions || store.predictions;
        store.stats = parsed.stats || store.stats;
        if (!store.stats.maxWinStreak) store.stats.maxWinStreak = store.stats.winStreak || 0;
        if (!store.stats.currentWinStreak) store.stats.currentWinStreak = 0;
        store.wrongStreak = parsed.wrongStreak || store.wrongStreak;
      }
    }
  } catch (e) {
    console.error("Lỗi loadStore:", e.message);
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8"); } catch(e2){}
  }
}

function saveStoreImmediate() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (e) {
    console.error("Lỗi saveStoreImmediate:", e.message);
  }
}

let saveTimeout = null;
function saveStoreDebounced(delay = 800) {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveStoreImmediate();
  }, delay);
}

loadStore();

// -------------------------
// Utils: Tai/Xiu + stats
// -------------------------
function getTaiXiu(score) {
  if (typeof score !== "number") return "N/A";
  if (score >= 4 && score <= 10) return "Xỉu";
  if (score >= 11 && score <= 17) return "Tài";
  return "N/A";
}

function fmtGameNum(raw) {
  if (raw == null) return null;
  const s = String(raw);
  return s.startsWith("#") ? s : `#${s}`;
}

function calculateStdDev(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

function calculateEntropy(sequence) {
  const freq = {};
  sequence.forEach(item => { freq[item] = (freq[item] || 0) + 1; });
  const total = sequence.length;
  let entropy = 0;
  Object.values(freq).forEach(count => { const p = count / total; if (p>0) entropy -= p * Math.log2(p); });
  return entropy;
}

// -------------------------
// Fixed predictViUltra (đồng bộ với getTaiXiu)
// -------------------------
function predictViUltra(history, prediction, window = 100) {
  if (!Array.isArray(history) || history.length === 0) {
    if (prediction === "Tài") return [13, 14, 15];
    if (prediction === "Xỉu") return [7, 8, 9];
    return [10, 11, 12];
  }

  const slice = history.slice(0, Math.min(window, history.length));
  const isXiu = prediction === "Xỉu";
  const rangeStart = isXiu ? 4 : 11;
  const rangeEnd = isXiu ? 10 : 17;

  const scores = {};
  const freq = {};
  const values = [];

  slice.forEach((h, idx) => {
    const s = Number(h.score);
    if (Number.isNaN(s)) return;
    values.push(s);
    freq[s] = (freq[s] || 0) + Math.pow(0.96, idx);
  });

  for (let v = rangeStart; v <= rangeEnd; v++) scores[v] = freq[v] || 0;

  const allInRange = values.filter(v => v >= rangeStart && v <= rangeEnd);
  if (allInRange.length >= 6) {
    const mean = allInRange.reduce((a, b) => a + b, 0) / allInRange.length;
    const stdDev = calculateStdDev(allInRange);
    if (stdDev < 1.9) {
      for (let v = Math.max(rangeStart, Math.floor(mean - 1)); v <= Math.min(rangeEnd, Math.ceil(mean + 1)); v++) {
        scores[v] = (scores[v] || 0) + 12;
      }
    } else if (stdDev > 2.6) {
      scores[rangeStart] = (scores[rangeStart] || 0) + 6;
      scores[rangeStart + 1] = (scores[rangeStart + 1] || 0) + 4;
      scores[rangeEnd] = (scores[rangeEnd] || 0) + 6;
      scores[rangeEnd - 1] = (scores[rangeEnd - 1] || 0) + 4;
    }
  }

  const last6 = slice.slice(0, 6).map(h => Number(h.score)).filter(n => n >= rangeStart && n <= rangeEnd);
  const hotCount = {};
  last6.forEach((n, i) => { hotCount[n] = (hotCount[n] || 0) + (6 - i) * 1.6; });
  Object.keys(hotCount).forEach(k => { scores[Number(k)] = (scores[Number(k)] || 0) + hotCount[k]; });

  if (last6.length >= 4) {
    const recentMean = last6.reduce((a, b) => a + b, 0) / last6.length;
    const center = (rangeStart + rangeEnd) / 2;
    if (Math.abs(recentMean - center) > 0.6) {
      for (let v = rangeStart; v <= rangeEnd; v++) {
        if ((recentMean > center && v > center) || (recentMean < center && v < center)) {
          scores[v] = (scores[v] || 0) + 3 * Math.min(1.5, Math.abs(recentMean - v) / (rangeEnd - rangeStart));
        }
      }
    }
  }

  const sorted = Object.entries(scores).map(([k, v]) => ({ v: Number(k), score: v }))
    .sort((a, b) => b.score - a.score);

  const result = [];
  for (const item of sorted) {
    if (result.length >= 3) break;
    const num = item.v;
    if (num >= rangeStart && num <= rangeEnd && !result.includes(num)) result.push(num);
  }

  const center = Math.floor((rangeStart + rangeEnd) / 2);
  for (let delta = 0; result.length < 3 && delta <= (rangeEnd - rangeStart); delta++) {
    const candA = center - delta;
    const candB = center + delta;
    if (candA >= rangeStart && !result.includes(candA)) result.push(candA);
    if (result.length >= 3) break;
    if (candB <= rangeEnd && !result.includes(candB)) result.push(candB);
  }

  return result.slice(0, 3);
}

// -------------------------
// Prediction algorithms (ultra ensemble + helpers)
// -------------------------
function algoDeepRecency(history) {
  const window = 12;
  const recent = history.slice(0, window);
  let taiScore = 0;
  let xiuScore = 0;
  recent.forEach((h, index) => {
    const weight = Math.pow(0.92, index) * 10;
    const tx = getTaiXiu(h.score);
    const momentumBonus = index < 3 ? 2 : 1;
    if (tx === "Tài") taiScore += weight * momentumBonus;
    else if (tx === "Xỉu") xiuScore += weight * momentumBonus;
  });
  const last3 = recent.slice(0, 3).map(h => getTaiXiu(h.score));
  const trendBonus = last3.filter(x => x === last3[0]).length === 3 ? 5 : 0;
  if (last3[0] === "Tài") taiScore += trendBonus; else if (last3[0] === "Xỉu") xiuScore += trendBonus;
  const pred = taiScore > xiuScore ? "Tài" : "Xỉu";
  const total = taiScore + xiuScore || 1;
  const conf = Math.min(97, 60 + (Math.abs(taiScore - xiuScore) / total) * 37);
  const vi = predictViUltra(history, pred, 80);
  return { prediction: pred, confidence: conf, vi, method: "deep-recency" };
}

function algoAdvancedFrequency(history) {
  const window = 60;
  const slice = history.slice(0, Math.min(window, history.length));
  const freq = {};
  const scoreFreq = {};
  slice.forEach((h, index) => {
    const tx = getTaiXiu(h.score);
    const s = h.score;
    const weight = Math.pow(0.97, index);
    freq[tx] = (freq[tx] || 0) + weight;
    scoreFreq[s] = (scoreFreq[s] || 0) + weight;
  });
  const pred = (freq["Tài"] || 0) > (freq["Xỉu"] || 0) ? "Tài" : "Xỉu";
  const total = (freq["Tài"] || 0) + (freq["Xỉu"] || 0) || 1;
  const dominance = Math.abs((freq["Tài"] || 0) - (freq["Xỉu"] || 0)) / total;
  const conf = Math.min(95, 55 + dominance * 40);
  const vi = predictViUltra(history, pred, 60);
  return { prediction: pred, confidence: conf, vi, method: "advanced-frequency" };
}

function algoUltraPattern(history) {
  const seq = history.slice(0, 15).map((h) => getTaiXiu(h.score));
  const patterns = {
    alternating: /^(TàiXỉu){3,}|(XỉuTài){3,}/,
    double: /^(TàiTài|XỉuXỉu){2,}/,
    triple: /(TàiTàiTài|XỉuXỉuXỉu)/
  };
  const joined = seq.join("");
  if (patterns.alternating.test(joined)) {
    const pred = seq[0] === "Tài" ? "Xỉu" : "Tài";
    const vi = predictViUltra(history, pred, 50);
    return { prediction: pred, confidence: 91, vi, method: "alternating-pattern" };
  }
  let streakCount = 1;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] === seq[0]) streakCount++; else break;
  }
  if (streakCount >= 5) {
    const pred = seq[0] === "Tài" ? "Xỉu" : "Tài";
    const vi = predictViUltra(history, pred, 50);
    const conf = Math.min(94, 72 + streakCount * 3);
    return { prediction: pred, confidence: conf, vi, method: "streak-reversal" };
  }

  // Advanced Markov Chain (fixed order)
  const transitions = { "TàiTài": 0, "TàiXỉu": 0, "XỉuTài": 0, "XỉuXỉu": 0 };
  const windowSize = Math.min(80, history.length);
  for (let i = 0; i < windowSize - 1; i++) {
    const current = getTaiXiu(history[i].score);
    const next = getTaiXiu(history[i + 1].score);
    const key = current + next;
    if (transitions[key] !== undefined) {
      const weight = Math.pow(0.98, i);
      transitions[key] += weight;
    }
  }
  const lastState = seq[0];
  const taiNext = lastState === "Tài" ? transitions["TàiTài"] : transitions["XỉuTài"];
  const xiuNext = lastState === "Tài" ? transitions["TàiXỉu"] : transitions["XỉuXỉu"];
  if (taiNext + xiuNext > 0) {
    const pred = taiNext > xiuNext ? "Tài" : "Xỉu";
    const conf = Math.min(92, 62 + (Math.abs(taiNext - xiuNext) / (taiNext + xiuNext)) * 30);
    const vi = predictViUltra(history, pred, 50);
    return { prediction: pred, confidence: conf, vi, method: "markov-chain" };
  }

  const entropy = calculateEntropy(seq.slice(0, 10));
  const pred = seq[0] === "Tài" ? "Xỉu" : "Tài";
  const conf = Math.max(65, 85 - entropy * 10);
  const vi = predictViUltra(history, pred, 50);
  return { prediction: pred, confidence: conf, vi, method: "entropy-analysis" };
}

function algoSmartReversion(history) {
  const window = 35;
  const slice = history.slice(0, Math.min(window, history.length));
  if (slice.length < 10) return null;
  const scores = slice.map(h => h.score);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const stdDev = calculateStdDev(scores);
  const lastScore = history[0].score;
  const deviation = lastScore - mean;
  const zScore = stdDev > 0 ? Math.abs(deviation) / stdDev : 0;
  if (zScore > 1.3) {
    const pred = lastScore > mean ? "Xỉu" : "Tài";
    const last3Avg = history.slice(0, 3).reduce((sum, h) => sum + h.score, 0) / 3;
    const momentumBonus = Math.abs(last3Avg - mean) > stdDev ? 5 : 0;
    const conf = Math.min(96, 68 + zScore * 12 + momentumBonus);
    const vi = predictViUltra(history, pred, 40);
    return { prediction: pred, confidence: conf, vi, method: "smart-reversion" };
  }
  return null;
}

function algoVolatilityPro(history) {
  const window = 30;
  const slice = history.slice(0, Math.min(window, history.length));
  if (slice.length < 15) return null;
  const scores = slice.map(h => h.score);
  const stdDev = calculateStdDev(scores);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const recentScores = scores.slice(0, 10);
  const recentStdDev = calculateStdDev(recentScores);
  if (stdDev < 1.9) {
    const last4 = history.slice(0, 4).map(h => getTaiXiu(h.score));
    const taiCount = last4.filter(x => x === "Tài").length;
    const pred = taiCount >= 3 ? "Tài" : taiCount <= 1 ? "Xỉu" : last4[0];
    const confidence = taiCount >= 3 || taiCount <= 1 ? 89 : 75;
    const vi = predictViUltra(history, pred, 40);
    return { prediction: pred, confidence, vi, method: "low-volatility-trend" };
  }
  if (stdDev > 2.6) {
    const lastScore = history[0].score;
    const pred = lastScore > mean ? "Xỉu" : "Tài";
    const extremeBonus = Math.abs(lastScore - mean) > stdDev * 1.5 ? 8 : 0;
    const conf = Math.min(88, 58 + (stdDev - 2.6) * 10 + extremeBonus);
    const vi = predictViUltra(history, pred, 40);
    return { prediction: pred, confidence: conf, vi, method: "high-volatility-reversion" };
  }
  return null;
}

function algoMomentum(history) {
  if (history.length < 15) return null;
  const recent = history.slice(0, 15);
  const scores = recent.map(h => h.score);
  const sma5 = scores.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const sma10 = scores.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
  const momentum = sma5 - sma10;
  if (Math.abs(momentum) > 0.5) {
    const pred = momentum > 0 ? "Tài" : "Xỉu";
    const conf = Math.min(86, 65 + Math.abs(momentum) * 15);
    const vi = predictViUltra(history, pred, 50);
    return { prediction: pred, confidence: conf, vi, method: "momentum-trend" };
  }
  return null;
}

function algoUltraEnsemble(history) {
  const algos = [
    { fn: algoDeepRecency, weight: 1.4 },
    { fn: algoAdvancedFrequency, weight: 1.1 },
    { fn: algoUltraPattern, weight: 1.6 },
    { fn: algoSmartReversion, weight: 1.4 },
    { fn: algoVolatilityPro, weight: 1.2 },
    { fn: algoMomentum, weight: 1.3 }
  ];

  const results = [];
  for (const algo of algos) {
    const res = algo.fn(history);
    if (res && res.prediction && res.prediction !== "N/A") {
      results.push({ ...res, baseWeight: algo.weight });
    }
  }

  if (results.length === 0) {
    return { prediction: "N/A", confidence: 0, vi: [], methods: [] };
  }

  const votes = { "Tài": 0, "Xỉu": 0 };
  const viScores = {};
  const methods = [];

  results.forEach(res => {
    const confWeight = Math.pow(res.confidence / 100, 1.2);
    const effectiveWeight = confWeight * res.baseWeight;
    votes[res.prediction] += effectiveWeight;
    if (Array.isArray(res.vi)) {
      res.vi.forEach((v, i) => {
        const viWeight = effectiveWeight / Math.pow(i + 1, 0.8);
        viScores[v] = (viScores[v] || 0) + viWeight;
      });
    }
    methods.push(res.method);
  });

  const finalPred = votes["Tài"] > votes["Xỉu"] ? "Tài" : "Xỉu";
  const totalVotes = votes["Tài"] + votes["Xỉu"] || 1;
  const diff = Math.abs(votes["Tài"] - votes["Xỉu"]);
  const consensusBonus = results.filter(r => r.prediction === finalPred).length >= 4 ? 5 : 0;
  const conf = Math.min(98, 52 + (diff / totalVotes) * 41 + consensusBonus);
  const viSorted = Object.entries(viScores).sort((a,b)=>b[1]-a[1]).map(x=>Number(x[0])).slice(0,3);
  const finalVi = viSorted.length ? viSorted : predictViUltra(history, finalPred, 80);
  return { prediction: finalPred, confidence: Number(conf.toFixed(1)), vi: finalVi, methods, votes };
}

// -------------------------
// History management & evaluation
// -------------------------
function addHistoryEntries(newList) {
  if (!Array.isArray(newList) || newList.length === 0) return [];
  const added = [];
  const known = new Set(store.history.map(h => String(h.gameNum)));
  for (const item of newList) {
    const raw = String(item.gameNum);
    if (known.has(raw)) continue;
    const rec = {
      gameNum: raw.startsWith("#") ? raw : `#${raw}`,
      facesList: item.facesList || item.faces || [],
      score: typeof item.score === "number" ? item.score : Number(item.score) || 0,
      time: item.time || item.createdAt || new Date().toISOString()
    };
    store.history.unshift(rec);
    added.push(rec);
    known.add(raw);
  }
  if (store.history.length > MAX_HISTORY) store.history = store.history.slice(0, MAX_HISTORY);
  if (added.length) saveStoreDebounced();
  return added;
}

function evaluatePredictionsForNewEntries(addedEntries) {
  if (!Array.isArray(addedEntries) || addedEntries.length === 0) return;
  for (const e of addedEntries) {
    const target = fmtGameNum(e.gameNum);
    const actual = getTaiXiu(e.score);
    const pred = store.predictions.find(p => p.predictedFor === target && p.evaluated === false);
    if (pred) {
      pred.evaluated = true;
      pred.evaluatedAt = new Date().toISOString();
      pred.actual = actual;
      pred.correct = pred.prediction === actual;
      pred.actualScore = e.score;
      store.stats.total = (store.stats.total || 0) + 1;
      if (pred.correct) {
        store.stats.correct = (store.stats.correct || 0) + 1;
        store.stats.currentWinStreak = (store.stats.currentWinStreak || 0) + 1;
        store.wrongStreak = 0;
        if (store.stats.currentWinStreak > store.stats.maxWinStreak) {
          store.stats.maxWinStreak = store.stats.currentWinStreak;
          console.log(`🎉 KỶ LỤC MỚI! Chuỗi thắng: ${store.stats.maxWinStreak}`);
        }
      } else {
        store.stats.wrong = (store.stats.wrong || 0) + 1;
        store.stats.currentWinStreak = 0;
        store.wrongStreak = (store.wrongStreak || 0) + 1;
      }
      const tot = (store.stats.correct || 0) + (store.stats.wrong || 0) || 1;
      store.stats.accuracy = tot ? ((store.stats.correct / tot) * 100).toFixed(2) + "%" : "0.00%";
      console.log(`${pred.correct ? "✅" : "❌"} ${target}: Dự đoán ${pred.prediction}, Thực tế ${actual} (${e.score})`);
      if (store.wrongStreak >= 5) console.log("⚠️ Sai liên tục >=5 lần – cần review thuật toán");
    }
  }
  saveStoreDebounced();
}

function createPredictionIfNeeded() {
  if (!store.history.length) return null;
  const latest = store.history[0];
  const raw = String(latest.gameNum).replace("#", "");
  const nextNum = isNaN(Number(raw)) ? null : Number(raw) + 1;
  if (!nextNum) return null;
  const predictedFor = `#${nextNum}`;
  const exist = store.predictions.find(p => p.predictedFor === predictedFor && p.evaluated === false);
  if (exist) return exist;
  const out = algoUltraEnsemble(store.history);
  if (!out || out.prediction === "N/A") return null;
  const vi = Array.isArray(out.vi) && out.vi.length >= 3 ? out.vi.slice(0,3) : predictViUltra(store.history, out.prediction, 80);
  const predObj = {
    predictedAt: new Date().toISOString(),
    predictedFor,
    algo: "ultra-ensemble-v12",
    prediction: out.prediction,
    confidence: Math.round(out.confidence),
    vi: vi,
    evaluated: false,
    createdAt: new Date().toISOString()
  };
  store.predictions.unshift(predObj);
  if (store.predictions.length > 500) store.predictions = store.predictions.slice(0,500);
  saveStoreDebounced();
  console.log(`🔮 Dự đoán ${predObj.predictedFor}: ${predObj.prediction} (${predObj.confidence}%) - Vị: ${vi.join(', ')}`);
  broadcast({ type: 'prediction', data: predObj });
  return predObj;
}

// -------------------------
// Fetch with retry + update loop lock
// -------------------------
async function fetchWithRetry(url, opts = {}, retries = 2, backoff = 700) {
  try {
    return await axios.get(url, opts);
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise(r => setTimeout(r, backoff));
    return fetchWithRetry(url, opts, retries - 1, Math.floor(backoff * 1.8));
  }
}

let isUpdating = false;
async function updateLoop() {
  if (isUpdating) return;
  isUpdating = true;
  try {
    const res = await fetchWithRetry(API_URL, { timeout: 10000 }, 2, 700);
    const list = res?.data?.data?.resultList || res?.data?.resultList || [];
    if (!Array.isArray(list) || list.length === 0) return;
    const added = addHistoryEntries(list);
    if (added.length) {
      console.log(`🔥 Thêm ${added.length} phiên mới`);
      evaluatePredictionsForNewEntries(added);
      broadcast({ type: 'history', data: added });
    }
    createPredictionIfNeeded();
  } catch (e) {
    console.error("updateLoop error:", e.message);
  } finally {
    isUpdating = false;
  }
}

updateLoop();
setInterval(updateLoop, UPDATE_INTERVAL);

// -------------------------
// Express + WebSocket server
// -------------------------
const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
let wsClients = new Set();

wss.on('connection', (socket) => {
  wsClients.add(socket);
  try { socket.send(JSON.stringify({ type: 'init', data: { historyHead: store.history[0] || null, stats: store.stats } })); } catch(e){}
  socket.on('close', () => { wsClients.delete(socket); });
});

function broadcast(obj) {
  const str = JSON.stringify(obj);
  for (const c of wsClients) {
    try { if (c.readyState === 1) c.send(str); } catch(e){}
  }
}

// -------------------------
// API endpoints (clean JSON)
// -------------------------
app.get('/', (req, res) => {
  res.json({ tên: 'Sicbo Sunwin Predictor VIP', phiên_bản: '12.0 No-Key', trạng_thái: 'đang_hoạt_động', dev: '@minhsangdangcap' });
});

app.get('/sicbosun/latest', (req, res) => {
  if (!store.history.length) return res.status(503).json({ trạng_thái: 'đang_tải', thông_báo: 'Hệ thống đang thu thập dữ liệu' });
  const latest = store.history[0];
  const raw = String(latest.gameNum).replace('#','');
  const next = isNaN(Number(raw)) ? null : `#${Number(raw)+1}`;
  const pending = store.predictions.find(p => p.predictedFor === next && p.evaluated === false) || null;
  res.json({ phiên_hiện_tại: latest.gameNum, xúc_xắc: latest.facesList, tổng_điểm: latest.score, kết_quả: getTaiXiu(latest.score), phiên_tiếp_theo: next, dự_đoán: pending ? pending.prediction : null, độ_tin_cậy: pending ? `${pending.confidence}%` : null, vị_đề_xuất: pending ? pending.vi : [], thống_kê: { tổng_dự_đoán: store.stats.total, số_đúng: store.stats.correct, số_sai: store.stats.wrong, tỷ_lệ_chính_xác: store.stats.accuracy, chuỗi_thắng_hiện_tại: store.stats.currentWinStreak, chuỗi_thắng_cao_nhất: store.stats.maxWinStreak } });
});

app.get('/sicbosun/predictions', (req, res) => {
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 20));
  const showAll = req.query.all === 'true';
  const filtered = showAll ? store.predictions : store.predictions.filter(p => p.evaluated);
  const out = filtered.slice(0, limit).map(p => ({ phiên: p.predictedFor, dự_đoán_lúc: p.predictedAt, dự_đoán: p.prediction, độ_tin_cậy: `${p.confidence}%`, vị_đề_xuất: p.vi || [], đã_kiểm_tra: p.evaluated, kết_quả_thực_tế: p.evaluated ? p.actual : null, điểm_thực_tế: p.evaluated ? p.actualScore : null, đúng_sai: p.evaluated ? p.correct : null, thời_gian_tạo: p.createdAt }));
  res.json({ tổng_số: filtered.length, hiển_thị: out.length, đã_đánh_giá: store.predictions.filter(p => p.evaluated).length, đang_chờ: store.predictions.filter(p => !p.evaluated).length, dữ_liệu: out });
});

app.get('/sicbosun/history', (req, res) => {
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit) || 50));
  const data = store.history.slice(0, limit).map(h => ({ phiên: h.gameNum, xúc_xắc: h.facesList, tổng_điểm: h.score, kết_quả: getTaiXiu(h.score), thời_gian: h.time }));
  res.json({ tổng_lịch_sử: store.history.length, hiển_thị: data.length, dữ_liệu: data });
});

app.get('/sicbosun/stats', (req, res) => {
  const evaluated = store.predictions.filter(p => p.evaluated);
  const correct = evaluated.filter(p => p.correct);
  const highConf = evaluated.filter(p => p.confidence >= 80);
  const highConfCorrect = highConf.filter(p => p.correct);
  const medConf = evaluated.filter(p => p.confidence >= 60 && p.confidence < 80);
  const medConfCorrect = medConf.filter(p => p.correct);
  const taiPreds = evaluated.filter(p => p.prediction === 'Tài');
  const xiuPreds = evaluated.filter(p => p.prediction === 'Xỉu');
  let maxStreak = 0; let currentStreak = 0; const streaks = [];
  evaluated.forEach(p => {
    if (p.correct) { currentStreak++; maxStreak = Math.max(maxStreak, currentStreak); } else { if (currentStreak>0) streaks.push(currentStreak); currentStreak=0; }
  });
  if (currentStreak>0) streaks.push(currentStreak);
  res.json({ tổng_quan: { tổng_dự_đoán: store.stats.total, số_đúng: store.stats.correct, số_sai: store.stats.wrong, tỷ_lệ_chính_xác: store.stats.accuracy, chuỗi_thắng_hiện_tại: store.stats.currentWinStreak, chuỗi_thắng_cao_nhất_mọi_thời_đại: store.stats.maxWinStreak }, phân_tích_theo_độ_tin_cậy: { cao_80_100: { tổng_số: highConf.length, số_đúng: highConfCorrect.length, tỷ_lệ: highConf.length ? `${((highConfCorrect.length / highConf.length) * 100).toFixed(2)}%` : "N/A" }, trung_bình_60_79: { tổng_số: medConf.length, số_đúng: medConfCorrect.length, tỷ_lệ: medConf.length ? `${((medConfCorrect.length / medConf.length) * 100).toFixed(2)}%` : "N/A" } }, phân_tích_theo_loại: { dự_đoán_tài: { tổng_số: taiPreds.length, số_đúng: taiPreds.filter(p => p.correct).length, tỷ_lệ: taiPreds.length ? `${((taiPreds.filter(p => p.correct).length / taiPreds.length) * 100).toFixed(2)}%` : "N/A" }, dự_đoán_xỉu: { tổng_số: xiuPreds.length, số_đúng: xiuPreds.filter(p => p.correct).length, tỷ_lệ: xiuPreds.length ? `${((xiuPreds.filter(p => p.correct).length / xiuPreds.length) * 100).toFixed(2)}%` : "N/A" } }, chuỗi_thắng: { hiện_tại: store.stats.currentWinStreak, cao_nhất_mọi_thời_đại: store.stats.maxWinStreak, các_chuỗi_gần_đây: streaks.slice(-5), trung_bình: streaks.length > 0 ? parseFloat((streaks.reduce((a,b)=>a+b,0)/streaks.length).toFixed(1)) : 0 } });
});

app.post('/sicbosun/manual', (req, res) => {
  const { history } = req.body;
  if (!Array.isArray(history) || history.length < 5) return res.status(400).json({ lỗi: 'Cần ít nhất 5 phiên trong history', ví_dụ: { history: [ { score: 14 }, { score: 8 }, { score: 15 } ] } });
  const formattedHistory = history.map((h, i) => ({ gameNum: `#test${i}`, score: h.score || 10, facesList: h.facesList || [], time: new Date().toISOString() }));
  const result = algoUltraEnsemble(formattedHistory);
  res.json({ dữ_liệu_đầu_vào: formattedHistory.slice(0,10).map(h=>({ điểm: h.score, kết_quả: getTaiXiu(h.score) })), dự_đoán: result.prediction, độ_tin_cậy: `${result.confidence}%`, vị_đề_xuất: result.vi, thuật_toán: 'ultra-ensemble-v12' });
});

app.post('/sicbosun/reset', (req, res) => {
  const { confirm, keepHistory } = req.body;
  if (confirm !== 'YES') return res.status(400).json({ lỗi: 'Cần xác nhận reset', thông_báo: "Gửi POST với body: { confirm: 'YES', keepHistory: true/false }" });
  if (!keepHistory) store.history = [];
  store.predictions = [];
  store.stats = { total:0, correct:0, wrong:0, accuracy:'0%', currentWinStreak:0, maxWinStreak:0 };
  store.wrongStreak = 0;
  saveStoreDebounced();
  res.json({ thành_công: true, thông_báo: 'Đã reset dữ liệu', giữ_lịch_sử: keepHistory || false });
});

app.get('/health', (req, res) => {
  res.json({ trạng_thái: 'khỏe_mạnh', thời_gian_hoạt_động: Math.floor(process.uptime()), bộ_nhớ_mb: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024), dữ_liệu: { lịch_sử: store.history.length, dự_đoán: store.predictions.length, cập_nhật_cuối: store.history[0]?.time || null } });
});

// -------------------------
// Graceful shutdown
// -------------------------
function flushAndExit() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8"); console.log("Store flushed to disk."); } catch (e) { console.error("Flush error:", e.message); }
  process.exit(0);
}
process.on('SIGINT', flushAndExit);
process.on('SIGTERM', flushAndExit);

// -------------------------
// Start server
// -------------------------
server.listen(PORT, () => {
  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║  🎲 SICBO SUNWIN PREDICTOR VIP v12.0 No-Key 🎲              ║`);
  console.log(`╠═══════════════════════════════════════════════════════════╣`);
  console.log(`║  🚀 Server: http://localhost:${PORT}                      ║`);
  console.log(`║  📡 Endpoint: /sicbosun/latest                            ║`);
  console.log(`║  📊 Stats: /sicbosun/stats                                ║`);
  console.log(`║  📜 History: /sicbosun/history                            ║`);
  console.log(`║  🔮 Predictions: /sicbosun/predictions                    ║`);
  console.log(`╠═══════════════════════════════════════════════════════════╣`);
  console.log(`║  ✨ FEATURES v12:                                         ║`);
  console.log(`║     • Ultra AI Ensemble (7 Algorithms)                    ║`);
  console.log(`║     • Smart Position Prediction (3-18)                    ║`);
  console.log(`║     • Deep Learning-Inspired Weighting                    ║`);
  console.log(`║     • Momentum & Volatility Analysis                      ║`);
  console.log(`║     • Entropy-Based Pattern Detection                     ║`);
  console.log(`║     • Enhanced Mean Reversion                             ║`);
  console.log(`║     • Clean JSON Response (No Cl
