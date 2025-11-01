// =======================================================
// SICBO SUNWIN PREDICTOR VIP v12.0 (ULTRA UPGRADED)
// Dev: @minhsangdangcap - AI Enhanced v12
// Chạy: npm install && npm start
// =======================================================

import express from "express";
import axios from "axios";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

// === Cấu hình nguồn dữ liệu ===
const API_URL =
  "https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=100&tableId=39791215743193&curPage=1";

const DATA_FILE = "./data.json";
const UPDATE_INTERVAL = 7000; // ms

// === Store persisted ===
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

// === Load / Save helpers ===
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
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
  }
}

function saveStore() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (e) {
    console.error("Lỗi saveStore:", e.message);
  }
}

loadStore();

// === Utils ===
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
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

function calculateEntropy(sequence) {
  const freq = {};
  sequence.forEach(item => {
    freq[item] = (freq[item] || 0) + 1;
  });
  
  const total = sequence.length;
  let entropy = 0;
  
  Object.values(freq).forEach(count => {
    const p = count / total;
    if (p > 0) entropy -= p * Math.log2(p);
  });
  
  return entropy;
}

// === VỊ PREDICTION NÂNG CẤP V2 (3-18) ===
function predictViUltra(history, prediction, window = 100) {
  if (!Array.isArray(history) || history.length === 0) {
    if (prediction === "Tài") return [13, 14, 15];
    if (prediction === "Xỉu") return [7, 8, 9];
    return [10, 11, 12];
  }

  const slice = history.slice(0, Math.min(window, history.length));
  
  const isXiu = prediction === "Xỉu";
  const rangeStart = isXiu ? 3 : 11;
  const rangeEnd = isXiu ? 10 : 18;
  
  // Multi-layer scoring system
  const scores = {};
  
  // Layer 1: Weighted frequency (40% importance)
  slice.forEach((h, index) => {
    const s = Number(h.score) || 0;
    if (s < rangeStart || s > rangeEnd) return;
    
    const recencyWeight = Math.pow(0.95, index); // Exponential decay
    const importance = 40;
    scores[s] = (scores[s] || 0) + (recencyWeight * importance);
  });

  // Layer 2: Hot streak detection (25% importance)
  const last8 = slice.slice(0, 8).map(h => Number(h.score)).filter(s => s >= rangeStart && s <= rangeEnd);
  const hotNums = {};
  last8.forEach((num, idx) => {
    const weight = (8 - idx) * 3.125; // 25% total importance
    hotNums[num] = (hotNums[num] || 0) + weight;
  });
  Object.keys(hotNums).forEach(key => {
    scores[key] = (scores[key] || 0) + hotNums[key];
  });

  // Layer 3: Momentum analysis (20% importance)
  if (last8.length >= 4) {
    const recentAvg = last8.slice(0, 4).reduce((a, b) => a + b, 0) / 4;
    const momentum = recentAvg - ((rangeStart + rangeEnd) / 2);
    
    for (let s = rangeStart; s <= rangeEnd; s++) {
      if (momentum > 0 && s > (rangeStart + rangeEnd) / 2) {
        scores[s] = (scores[s] || 0) + (20 * (s - rangeStart) / (rangeEnd - rangeStart));
      } else if (momentum < 0 && s < (rangeStart + rangeEnd) / 2) {
        scores[s] = (scores[s] || 0) + (20 * (rangeEnd - s) / (rangeEnd - rangeStart));
      }
    }
  }

  // Layer 4: Volatility clustering (15% importance)
  const allScores = slice.map(h => Number(h.score)).filter(s => s >= rangeStart && s <= rangeEnd);
  if (allScores.length >= 10) {
    const stdDev = calculateStdDev(allScores);
    const mean = allScores.reduce((a, b) => a + b, 0) / allScores.length;
    
    if (stdDev < 1.8) {
      // Low volatility: cluster around mean
      for (let s = Math.max(rangeStart, Math.floor(mean - 1.5)); 
           s <= Math.min(rangeEnd, Math.ceil(mean + 1.5)); s++) {
        scores[s] = (scores[s] || 0) + 15;
      }
    } else if (stdDev > 2.8) {
      // High volatility: favor extremes
      [rangeStart, rangeStart + 1, rangeEnd - 1, rangeEnd].forEach(s => {
        scores[s] = (scores[s] || 0) + 7.5;
      });
    }
  }

  // Sort and return top 3
  const sorted = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(x => Number(x[0]));

  if (sorted.length >= 3) {
    return sorted.slice(0, 3);
  }

  // Smart fallback
  if (isXiu) {
    const center = Math.floor((rangeStart + rangeEnd) / 2);
    return [center, center - 1, center + 1].filter(s => s >= rangeStart && s <= rangeEnd);
  } else {
    const center = Math.floor((rangeStart + rangeEnd) / 2);
    return [center, center + 1, center - 1].filter(s => s >= rangeStart && s <= rangeEnd);
  }
}

// === THUẬT TOÁN DỰ ĐOÁN NÂNG CẤP V2 ===

// 1. Deep Learning-inspired Recency
function algoDeepRecency(history) {
  const window = 12;
  const recent = history.slice(0, window);
  
  let taiScore = 0;
  let xiuScore = 0;
  
  recent.forEach((h, index) => {
    const weight = Math.pow(0.92, index) * 10; // Exponential weighting
    const tx = getTaiXiu(h.score);
    
    // Add momentum bonus
    const momentumBonus = index < 3 ? 2 : 1;
    
    if (tx === "Tài") taiScore += weight * momentumBonus;
    else if (tx === "Xỉu") xiuScore += weight * momentumBonus;
  });
  
  // Analyze short-term trend
  const last3 = recent.slice(0, 3).map(h => getTaiXiu(h.score));
  const trendBonus = last3.filter(x => x === last3[0]).length === 3 ? 5 : 0;
  
  if (last3[0] === "Tài") taiScore += trendBonus;
  else if (last3[0] === "Xỉu") xiuScore += trendBonus;
  
  const pred = taiScore > xiuScore ? "Tài" : "Xỉu";
  const total = taiScore + xiuScore;
  const conf = Math.min(97, 60 + (Math.abs(taiScore - xiuScore) / total) * 37);
  const vi = predictViUltra(history, pred, 80);
  
  return { prediction: pred, confidence: conf, vi, method: "deep-recency" };
}

// 2. Statistical Frequency v2
function algoAdvancedFrequency(history) {
  const window = 60;
  const slice = history.slice(0, Math.min(window, history.length));
  
  // Weighted frequency with time decay
  const freq = {};
  const scoreFreq = {};
  
  slice.forEach((h, index) => {
    const tx = getTaiXiu(h.score);
    const s = h.score;
    const weight = Math.pow(0.97, index);
    
    freq[tx] = (freq[tx] || 0) + weight;
    scoreFreq[s] = (scoreFreq[s] || 0) + weight;
  });
  
  // Get dominant prediction
  const pred = (freq["Tài"] || 0) > (freq["Xỉu"] || 0) ? "Tài" : "Xỉu";
  
  // Calculate confidence based on distribution
  const total = (freq["Tài"] || 0) + (freq["Xỉu"] || 0);
  const dominance = Math.abs((freq["Tài"] || 0) - (freq["Xỉu"] || 0)) / total;
  
  const conf = Math.min(95, 55 + dominance * 40);
  const vi = predictViUltra(history, pred, 60);
  
  return { prediction: pred, confidence: conf, vi, method: "advanced-frequency" };
}

// 3. Enhanced Pattern Recognition
function algoUltraPattern(history) {
  const seq = history.slice(0, 15).map((h) => getTaiXiu(h.score));
  
  // Detect complex patterns
  const patterns = {
    alternating: /^(TàiXỉu){3,}|(XỉuTài){3,}/,
    double: /^(TàiTài|XỉuXỉu){2,}/,
    triple: /(TàiTàiTài|XỉuXỉuXỉu)/
  };
  
  const joined = seq.join("");
  
  // Check for alternating pattern
  if (patterns.alternating.test(joined)) {
    const pred = seq[0] === "Tài" ? "Xỉu" : "Tài";
    const vi = predictViUltra(history, pred, 50);
    return { prediction: pred, confidence: 91, vi, method: "alternating-pattern" };
  }
  
  // Streak reversal with confidence scaling
  let streakCount = 1;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] === seq[0]) streakCount++;
    else break;
  }
  
  if (streakCount >= 5) {
    const pred = seq[0] === "Tài" ? "Xỉu" : "Tài";
    const vi = predictViUltra(history, pred, 50);
    const conf = Math.min(94, 72 + streakCount * 3);
    return { prediction: pred, confidence: conf, vi, method: "streak-reversal" };
  }
  
  // Advanced Markov Chain
  const transitions = { "TàiTài": 0, "TàiXỉu": 0, "XỉuTài": 0, "XỉuXỉu": 0 };
  const window = Math.min(80, history.length);
  
  for (let i = 0; i < window - 1; i++) {
    const current = getTaiXiu(history[i + 1].score);
    const next = getTaiXiu(history[i].score);
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
  
  // Entropy-based prediction
  const entropy = calculateEntropy(seq.slice(0, 10));
  const pred = seq[0] === "Tài" ? "Xỉu" : "Tài";
  const conf = Math.max(65, 85 - entropy * 10);
  const vi = predictViUltra(history, pred, 50);
  
  return { prediction: pred, confidence: conf, vi, method: "entropy-analysis" };
}

// 4. Advanced Mean Reversion
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
  
  // Enhanced reversion logic
  if (zScore > 1.3) {
    const pred = lastScore > mean ? "Xỉu" : "Tài";
    
    // Add momentum check
    const last3Avg = history.slice(0, 3).reduce((sum, h) => sum + h.score, 0) / 3;
    const momentumBonus = Math.abs(last3Avg - mean) > stdDev ? 5 : 0;
    
    const conf = Math.min(96, 68 + zScore * 12 + momentumBonus);
    const vi = predictViUltra(history, pred, 40);
    return { prediction: pred, confidence: conf, vi, method: "smart-reversion" };
  }
  
  return null;
}

// 5. Volatility Strategy v2
function algoVolatilityPro(history) {
  const window = 30;
  const slice = history.slice(0, Math.min(window, history.length));
  
  if (slice.length < 15) return null;
  
  const scores = slice.map(h => h.score);
  const stdDev = calculateStdDev(scores);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  
  // Calculate recent volatility
  const recentScores = scores.slice(0, 10);
  const recentStdDev = calculateStdDev(recentScores);
  const volatilityChange = recentStdDev - stdDev;
  
  // Low volatility -> trend continuation with momentum
  if (stdDev < 1.9) {
    const last4 = history.slice(0, 4).map(h => getTaiXiu(h.score));
    const taiCount = last4.filter(x => x === "Tài").length;
    const pred = taiCount >= 3 ? "Tài" : taiCount <= 1 ? "Xỉu" : last4[0];
    
    const confidence = taiCount >= 3 || taiCount <= 1 ? 89 : 75;
    const vi = predictViUltra(history, pred, 40);
    return { prediction: pred, confidence, vi, method: "low-volatility-trend" };
  }
  
  // High volatility -> reversion with smart exit
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

// 6. Momentum & Trend Following
function algoMomentum(history) {
  if (history.length < 15) return null;
  
  const recent = history.slice(0, 15);
  const scores = recent.map(h => h.score);
  
  // Calculate momentum indicators
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

// 7. Ultra Ensemble với Machine Learning weighting
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
  
  // Weighted voting with confidence boosting
  const votes = { "Tài": 0, "Xỉu": 0 };
  const viScores = {};
  const methods = [];
  
  results.forEach(res => {
    const confWeight = Math.pow(res.confidence / 100, 1.2); // Non-linear confidence scaling
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
  const totalVotes = votes["Tài"] + votes["Xỉu"];
  const diff = Math.abs(votes["Tài"] - votes["Xỉu"]);
  
  // Enhanced confidence calculation
  const consensusBonus = results.filter(r => r.prediction === finalPred).length >= 4 ? 5 : 0;
  const conf = Math.min(98, 52 + (diff / totalVotes) * 41 + consensusBonus);
  
  const viSorted = Object.entries(viScores)
    .sort((a, b) => b[1] - a[1])
    .map(x => Number(x[0]))
    .slice(0, 3);
  
  const finalVi = viSorted.length ? viSorted : predictViUltra(history, finalPred, 80);
  
  return { 
    prediction: finalPred, 
    confidence: Number(conf.toFixed(1)), 
    vi: finalVi,
    methods: methods,
    votes: votes
  };
}

// === PREDICTION LIFECYCLE ===
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
  
  if (store.history.length > 2000) store.history = store.history.slice(0, 2000);
  if (added.length) saveStore();
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
      
      const tot = (store.stats.correct || 0) + (store.stats.wrong || 0);
      store.stats.accuracy = tot ? ((store.stats.correct / tot) * 100).toFixed(2) + "%" : "0.00%";
      
      console.log(`${pred.correct ? "✅" : "❌"} #${target}: Dự đoán ${pred.prediction}, Thực tế ${actual} (${e.score})`);
      
      if (store.wrongStreak >= 5) {
        console.log("⚠️ Sai liên tục >=5 lần – cần review thuật toán");
      }
    }
  }
  
  saveStore();
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

  const vi = Array.isArray(out.vi) && out.vi.length >= 3 
    ? out.vi.slice(0, 3) 
    : predictViUltra(store.history, out.prediction, 80);

  const predObj = {
    predictedAt: latest.gameNum,
    predictedFor,
    algo: "ultra-ensemble-v12",
    prediction: out.prediction,
    confidence: Math.round(out.confidence),
    vi: vi,
    evaluated: false,
    createdAt: new Date().toISOString()
  };
  
  store.predictions.unshift(predObj);
  
  if (store.predictions.length > 500) {
    store.predictions = store.predictions.slice(0, 500);
  }
  
  saveStore();
  console.log(`🔮 Dự đoán #${predictedFor}: ${predObj.prediction} (${predObj.confidence}%) - Vị: ${vi.join(', ')}`);
  
  return predObj;
}

// === MAIN UPDATE LOOP ===
async function updateLoop() {
  try {
    const res = await axios.get(API_URL, { timeout: 10000 });
    const list = res?.data?.data?.resultList;
    if (!Array.isArray(list) || list.length === 0) return;
    
    const added = addHistoryEntries(list);
    if (added.length) {
      console.log(`🔥 Thêm ${added.length} phiên mới`);
      evaluatePredictionsForNewEntries(added);
    }
    
    createPredictionIfNeeded();
  } catch (e) {
    console.error("updateLoop error:", e.message);
  }
}

updateLoop();
setInterval(updateLoop, UPDATE_INTERVAL);

// === API ENDPOINTS (CLEAN JSON) ===
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    tên: "Sicbo Sunwin Predictor VIP",
    phiên_bản: "12.0",
    trạng_thái: "đang_hoạt_động",
    dev: "@minhsangdangcap"
  });
});

app.get("/sicbosun/latest", (req, res) => {
  if (!store.history.length) {
    return res.status(503).json({ 
      trạng_thái: "đang_tải",
      thông_báo: "Hệ thống đang thu thập dữ liệu"
    });
  }
  
  const latest = store.history[0];
  const raw = String(latest.gameNum).replace("#", "");
  const next = isNaN(Number(raw)) ? null : `#${Number(raw) + 1}`;
  const pending = store.predictions.find(p => p.predictedFor === next && p.evaluated === false) || null;

  res.json({
    phiên_hiện_tại: latest.gameNum,
    xúc_xắc: latest.facesList,
    tổng_điểm: latest.score,
    kết_quả: getTaiXiu(latest.score),
    phiên_tiếp_theo: next,
    dự_đoán: pending ? pending.prediction : null,
    độ_tin_cậy: pending ? `${pending.confidence}%` : null,
    vị_đề_xuất: pending ? pending.vi : [],
    thống_kê: {
      tổng_dự_đoán: store.stats.total,
      số_đúng: store.stats.correct,
      số_sai: store.stats.wrong,
      tỷ_lệ_chính_xác: store.stats.accuracy,
      chuỗi_thắng_hiện_tại: store.stats.currentWinStreak,
      chuỗi_thắng_cao_nhất: store.stats.maxWinStreak
    }
  });
});

app.get("/sicbosun/predictions", (req, res) => {
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 20));
  const showAll = req.query.all === "true";
  
  const filtered = showAll 
    ? store.predictions 
    : store.predictions.filter(p => p.evaluated);
  
  const out = filtered.slice(0, limit).map(p => ({
    phiên: p.predictedFor,
    dự_đoán_lúc: p.predictedAt,
    dự_đoán: p.prediction,
    độ_tin_cậy: `${p.confidence}%`,
    vị_đề_xuất: p.vi || [],
    đã_kiểm_tra: p.evaluated,
    kết_quả_thực_tế: p.evaluated ? p.actual : null,
    điểm_thực_tế: p.evaluated ? p.actualScore : null,
    đúng_sai: p.evaluated ? p.correct : null,
    thời_gian_tạo: p.createdAt
  }));
  
  res.json({ 
    tổng_số: filtered.length, 
    hiển_thị: out.length,
    đã_đánh_giá: store.predictions.filter(p => p.evaluated).length,
    đang_chờ: store.predictions.filter(p => !p.evaluated).length,
    dữ_liệu: out 
  });
});

app.get("/sicbosun/history", (req, res) => {
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit) || 50));
  
  const data = store.history.slice(0, limit).map(h => ({
    phiên: h.gameNum,
    xúc_xắc: h.facesList,
    tổng_điểm: h.score,
    kết_quả: getTaiXiu(h.score),
    thời_gian: h.time
  }));
  
  res.json({
    tổng_lịch_sử: store.history.length,
    hiển_thị: data.length,
    dữ_liệu: data
  });
});

app.get("/sicbosun/stats", (req, res) => {
  const evaluated = store.predictions.filter(p => p.evaluated);
  const correct = evaluated.filter(p => p.correct);
  
  // Confidence level analysis
  const highConf = evaluated.filter(p => p.confidence >= 80);
  const highConfCorrect = highConf.filter(p => p.correct);
  const medConf = evaluated.filter(p => p.confidence >= 60 && p.confidence < 80);
  const medConfCorrect = medConf.filter(p => p.correct);
  
  // Tai/Xiu analysis
  const taiPreds = evaluated.filter(p => p.prediction === "Tài");
  const xiuPreds = evaluated.filter(p => p.prediction === "Xỉu");
  
  // Win streaks analysis
  let maxStreak = 0;
  let currentStreak = 0;
  const streaks = [];
  
  evaluated.forEach(p => {
    if (p.correct) {
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      if (currentStreak > 0) streaks.push(currentStreak);
      currentStreak = 0;
    }
  });
  if (currentStreak > 0) streaks.push(currentStreak);
  
  res.json({
    tổng_quan: {
      tổng_dự_đoán: store.stats.total,
      số_đúng: store.stats.correct,
      số_sai: store.stats.wrong,
      tỷ_lệ_chính_xác: store.stats.accuracy,
      chuỗi_thắng_hiện_tại: store.stats.currentWinStreak,
      chuỗi_thắng_cao_nhất_mọi_thời_đại: store.stats.maxWinStreak
    },
    phân_tích_theo_độ_tin_cậy: {
      cao_80_100: {
        tổng_số: highConf.length,
        số_đúng: highConfCorrect.length,
        tỷ_lệ: highConf.length ? `${((highConfCorrect.length / highConf.length) * 100).toFixed(2)}%` : "N/A"
      },
      trung_bình_60_79: {
        tổng_số: medConf.length,
        số_đúng: medConfCorrect.length,
        tỷ_lệ: medConf.length ? `${((medConfCorrect.length / medConf.length) * 100).toFixed(2)}%` : "N/A"
      }
    },
    phân_tích_theo_loại: {
      dự_đoán_tài: {
        tổng_số: taiPreds.length,
        số_đúng: taiPreds.filter(p => p.correct).length,
        tỷ_lệ: taiPreds.length ? `${((taiPreds.filter(p => p.correct).length / taiPreds.length) * 100).toFixed(2)}%` : "N/A"
      },
      dự_đoán_xỉu: {
        tổng_số: xiuPreds.length,
        số_đúng: xiuPreds.filter(p => p.correct).length,
        tỷ_lệ: xiuPreds.length ? `${((xiuPreds.filter(p => p.correct).length / xiuPreds.length) * 100).toFixed(2)}%` : "N/A"
      }
    },
    chuỗi_thắng: {
      hiện_tại: store.stats.currentWinStreak,
      cao_nhất_mọi_thời_đại: store.stats.maxWinStreak,
      các_chuỗi_gần_đây: streaks.slice(-5),
      trung_bình: streaks.length > 0 ? parseFloat((streaks.reduce((a, b) => a + b, 0) / streaks.length).toFixed(1)) : 0
    }
  });
});

app.post("/sicbosun/manual", (req, res) => {
  const { history } = req.body;
  
  if (!Array.isArray(history) || history.length < 5) {
    return res.status(400).json({ 
      lỗi: "Cần ít nhất 5 phiên trong history",
      ví_dụ: {
        history: [
          { score: 14 },
          { score: 8 },
          { score: 15 }
        ]
      }
    });
  }
  
  const formattedHistory = history.map((h, i) => ({
    gameNum: `#test${i}`,
    score: h.score || 10,
    facesList: h.facesList || [],
    time: new Date().toISOString()
  }));
  
  const result = algoUltraEnsemble(formattedHistory);
  
  res.json({
    dữ_liệu_đầu_vào: formattedHistory.slice(0, 10).map(h => ({
      điểm: h.score,
      kết_quả: getTaiXiu(h.score)
    })),
    dự_đoán: result.prediction,
    độ_tin_cậy: `${result.confidence}%`,
    vị_đề_xuất: result.vi,
    thuật_toán: "ultra-ensemble-v12"
  });
});

app.post("/sicbosun/reset", (req, res) => {
  const { confirm, keepHistory } = req.body;
  
  if (confirm !== "YES") {
    return res.status(400).json({
      lỗi: "Cần xác nhận reset",
      thông_báo: "Gửi POST với body: { confirm: 'YES', keepHistory: true/false }"
    });
  }
  
  if (!keepHistory) {
    store.history = [];
  }
  
  store.predictions = [];
  store.stats = {
    total: 0,
    correct: 0,
    wrong: 0,
    accuracy: "0%",
    currentWinStreak: 0,
    maxWinStreak: 0
  };
  store.wrongStreak = 0;
  
  saveStore();
  
  res.json({
    thành_công: true,
    thông_báo: "Đã reset dữ liệu",
    giữ_lịch_sử: keepHistory || false
  });
});

app.get("/health", (req, res) => {
  res.json({
    trạng_thái: "khỏe_mạnh",
    thời_gian_hoạt_động: Math.floor(process.uptime()),
    bộ_nhớ_mb: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024),
    dữ_liệu: {
      lịch_sử: store.history.length,
      dự_đoán: store.predictions.length,
      cập_nhật_cuối: store.history[0]?.time || null
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║  🎲 SICBO SUNWIN PREDICTOR VIP v12.0 🎲                   ║
╠═══════════════════════════════════════════════════════════╣
║  🚀 Server: http://localhost:${PORT}                      ║
║  📡 Endpoint: /sicbosun/latest                            ║
║  📊 Stats: /sicbosun/stats                                ║
║  📜 History: /sicbosun/history                            ║
║  🔮 Predictions: /sicbosun/predictions                    ║
╠═══════════════════════════════════════════════════════════╣
║  ✨ FEATURES v12:                                         ║
║     • Ultra AI Ensemble (7 Algorithms)                    ║
║     • Smart Position Prediction (3-18)                    ║
║     • Deep Learning-Inspired Weighting                    ║
║     • Momentum & Volatility Analysis                      ║
║     • Entropy-Based Pattern Detection                     ║
║     • Enhanced Mean Reversion                             ║
║     • Clean JSON Response (No Clutter)                    ║
╠═══════════════════════════════════════════════════════════╣
║  📈 Current Stats:                                        ║
║     Total: ${String(store.stats.total || 0).padEnd(3)} | Accuracy: ${String(store.stats.accuracy || '0%').padEnd(8)}      ║
║     Streak: ${String(store.stats.currentWinStreak || 0).padEnd(2)} | Max: ${String(store.stats.maxWinStreak || 0).padEnd(15)}                ║
╠═══════════════════════════════════════════════════════════╣
║  💨 Update: Every ${UPDATE_INTERVAL / 1000}s | 📦 File: ${DATA_FILE}        ║
║  👨‍💻 Dev: @minhsangdangcap | 🤖 AI Enhanced v12          ║
╚═══════════════════════════════════════════════════════════╝
  `);
  
  console.log(`\n⚡ System initialized successfully!`);
  console.log(`🌐 API: ${API_URL.substring(0, 50)}...\n`);
});
