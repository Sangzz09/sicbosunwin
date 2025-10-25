// =====================================================
// Sicbo Sunwin Predictor v9.0 - FULL CODE HOÀN CHỈNH
// - Nhiều thuật toán (pattern, frequency, recency, markov, ensemble)
// - Chọn thuật toán "đang thắng" dựa trên hiệu suất gần đây
// - Thống kê chính xác: evaluate prediction khi kết quả của phiên đó xuất hiện
// - Lưu trạng thái vào data.json (history + predictions + algoStats + stats)
// - JSON trả về tiếng Việt, không lộ chi tiết thuật toán
// Dev: @minhsangdangcap
// =====================================================

import express from "express";
import axios from "axios";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

const API_URL =
  "https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=100&tableId=39791215743193&curPage=1";
const DATA_FILE = "./data.json";
const UPDATE_INTERVAL = 8000; // ms

// store structure persisted to disk
let store = {
  history: [], // newest-first: { gameNum:"#123", facesList:[], score:14, result:"Tài", time:"..." }
  predictions: [], // newest-first: { predictedFor:"#124", predictedAt:"#123", algo:"recency", prediction:"Tài", confidence:85, evaluated:false, correct:null, createdAt:"" }
  algoStats: {
    // stats for each algo to pick best one on recent window
    recency: { tested: 0, correct: 0 },
    frequency: { tested: 0, correct: 0 },
    pattern: { tested: 0, correct: 0 },
    markov: { tested: 0, correct: 0 },
    ensemble: { tested: 0, correct: 0 }
  },
  stats: { totalPredicted: 0, correct: 0, wrong: 0, accuracy: "0.00%", winStreak: 0 }
};

// load / save helpers
function loadStore() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
    return;
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") {
      store = {
        history: obj.history || [],
        predictions: obj.predictions || [],
        algoStats: obj.algoStats || store.algoStats,
        stats: obj.stats || store.stats
      };
    }
  } catch (e) {
    console.error("Không thể đọc data.json, tạo mới:", e.message);
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
  }
}
function saveStore() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf-8");
}
loadStore();

// utils
function fmtGameNum(raw) {
  if (raw == null) return null;
  const s = String(raw);
  return s.startsWith("#") ? s : `#${s}`;
}
function getTaiXiu(score) {
  if (typeof score !== "number") return "Không xác định";
  if (score >= 4 && score <= 10) return "Xỉu";
  if (score >= 11 && score <= 17) return "Tài";
  return "Không xác định";
}

// ---------- ALGORITHMS (internal, do not expose their internals in responses) ----------
// Each returns {prediction: "Tài"|"Xỉu"|"N/A", confidence: number 0-100}

// 1) Recency majority (last N)
function algoRecency(history, N = 7) {
  if (!history || history.length === 0) return { prediction: "N/A", confidence: 0 };
  const slice = history.slice(0, N);
  const tai = slice.filter(h => getTaiXiu(h.score) === "Tài").length;
  const xiu = slice.length - tai;
  const pred = tai > xiu ? "Tài" : xiu > tai ? "Xỉu" : getTaiXiu(history[0].score) || "Tài";
  const conf = Math.min(95, 50 + (Math.abs(tai - xiu) / slice.length) * 50);
  return { prediction: pred, confidence: Number(conf.toFixed(1)) };
}

// 2) Frequency of totals -> map to Tai/Xiu
function algoFrequency(history, window = 20) {
  if (!history || history.length === 0) return { prediction: "N/A", confidence: 0 };
  const slice = history.slice(0, window);
  const freq = {};
  slice.forEach(h => freq[h.score] = (freq[h.score] || 0) + 1);
  const sorted = Object.entries(freq).sort((a,b) => b[1]-a[1]);
  if (sorted.length === 0) return { prediction: "N/A", confidence: 0 };
  const top = Number(sorted[0][0]);
  const pred = getTaiXiu(top);
  const conf = Math.min(90, 40 + (sorted[0][1]/slice.length)*60);
  return { prediction: pred, confidence: Number(conf.toFixed(1)) };
}

// 3) Pattern detector (1-1, 2-2, bệt)
function algoPattern(history) {
  if (!history || history.length < 4) return { prediction: "N/A", confidence: 0 };
  const seq = history.slice(0,8).map(h => getTaiXiu(h.score));
  // detect 1-1 pattern
  const p4 = seq.slice(0,4).join(",");
  if (p4 === "Tài,Xỉu,Tài,Xỉu" || p4 === "Xỉu,Tài,Xỉu,Tài") {
    const pred = seq[0] === "Tài" ? "Xỉu" : "Tài"; // alternate
    return { prediction: pred, confidence: 88.0 };
  }
  // detect 2-2: positions 0-1 equal, 2-3 equal and different
  if (seq[0] && seq[1] && seq[0] === seq[1] && seq[2] === seq[3] && seq[0] !== seq[2]) {
    const pred = seq[0] === "Tài" ? "Xỉu" : "Tài";
    return { prediction: pred, confidence: 86.0 };
  }
  // detect bệt (all same)
  if (seq.slice(0,6).every(v => v === seq[0])) {
    return { prediction: seq[0], confidence: 80.0 };
  }
  return { prediction: "N/A", confidence: 0 };
}

// 4) Markov 1-step transitions
function algoMarkov(history) {
  if (!history || history.length < 6) return { prediction: "N/A", confidence: 0 };
  const seq = history.map(h => getTaiXiu(h.score));
  const trans = { "Tài": { "Tài":0, "Xỉu":0 }, "Xỉu": { "Tài":0, "Xỉu":0 } };
  for (let i=0;i<seq.length-1;i++){
    const a = seq[i], b = seq[i+1];
    if (a && b) trans[a][b] = (trans[a][b]||0)+1;
  }
  const curr = seq[0];
  if (!curr) return { prediction: "N/A", confidence: 0 };
  const t = trans[curr];
  const pred = (t["Tài"] >= t["Xỉu"]) ? "Tài" : "Xỉu";
  const total = t["Tài"] + t["Xỉu"];
  const conf = total ? Math.min(95, 45 + Math.abs(t["Tài"]-t["Xỉu"])/total * 55) : 50;
  return { prediction: pred, confidence: Number(conf.toFixed(1)) };
}

// 5) Simple ensemble (combines above)
function algoEnsemble(history) {
  const a1 = algoRecency(history);
  const a2 = algoFrequency(history);
  const a3 = algoPattern(history);
  const a4 = algoMarkov(history);

  const algos = [ {name:"recency", out:a1, w:1.1}, {name:"frequency", out:a2, w:1.0}, {name:"pattern", out:a3, w:1.2}, {name:"markov", out:a4, w:1.15} ];
  const votes = { "Tài":0, "Xỉu":0 };
  for (const a of algos) {
    if (!a.out || a.out.prediction === "N/A") continue;
    votes[a.out.prediction] += (a.out.confidence/100) * a.w;
  }
  const final = votes["Tài"] > votes["Xỉu"] ? "Tài" : "Xỉu";
  const diff = Math.abs(votes["Tài"] - votes["Xỉu"]);
  const conf = Math.min(99, 45 + (diff / (votes["Tài"]+votes["Xỉu"] || 1)) * 55);
  return { prediction: final, confidence: Number(conf.toFixed(1)) };
}

// ---------- Algorithm selector ----------
// Choose algo name based on recent algoStats performance (last window)
function pickBestAlgo() {
  // compute success rate per algo (with small prior to avoid zero-division)
  const scores = Object.entries(store.algoStats).map(([name, st]) => {
    const tested = st.tested || 0;
    const correct = st.correct || 0;
    const rate = (correct + 1) / (tested + 2); // Laplace smoothing
    return { name, rate };
  });
  // pick max rate
  scores.sort((a,b)=>b.rate - a.rate);
  return scores[0]?.name || "ensemble";
}

// mapping name->function
const ALGO_MAP = {
  recency: (h)=>algoRecency(h,7),
  frequency: (h)=>algoFrequency(h,20),
  pattern: (h)=>algoPattern(h),
  markov: (h)=>algoMarkov(h),
  ensemble: (h)=>algoEnsemble(h)
};

// ---------- Prediction lifecycle & evaluation ----------

// add history items (dedup) newest-first; return added entries (newest-first)
function addHistoryEntries(newList) {
  if (!Array.isArray(newList) || newList.length === 0) return [];
  const added = [];
  const known = new Set(store.history.map(h=>String(h.gameNum)));
  for (const item of newList) {
    const raw = String(item.gameNum);
    if (known.has(raw)) continue;
    const rec = {
      gameNum: raw.startsWith("#") ? raw : `#${raw}`,
      facesList: item.facesList || item.faces || [],
      score: typeof item.score === "number" ? item.score : Number(item.score) || 0,
      result: getTaiXiu(typeof item.score === "number" ? item.score : Number(item.score) || 0),
      time: item.time || item.createdAt || new Date().toISOString()
    };
    store.history.unshift(rec);
    added.push(rec);
    known.add(raw);
  }
  // limit
  if (store.history.length > 800) store.history = store.history.slice(0,800);
  if (added.length) saveStore();
  return added;
}

// evaluate pending predictions for newly added entries
function evaluatePredictionsForNewEntries(addedEntries) {
  if (!addedEntries.length) return;
  // entries are newest-first; evaluate each
  for (const e of addedEntries) {
    const target = fmtGameNum(e.gameNum);
    const actual = e.result;
    // find pending prediction for this target
    const pred = store.predictions.find(p => p.predictedFor === target && p.evaluated === false);
    if (pred) {
      pred.evaluated = true;
      pred.evaluatedAt = new Date().toISOString();
      pred.actual = actual;
      pred.correct = pred.prediction === actual;
      // update global stats
      store.stats.totalPredicted = (store.stats.totalPredicted || 0) + 1;
      if (pred.correct) {
        store.stats.correct = (store.stats.correct || 0) + 1;
        store.stats.winStreak = (store.stats.winStreak || 0) + 1;
      } else {
        store.stats.wrong = (store.stats.wrong || 0) + 1;
        store.stats.winStreak = 0;
      }
      const tot = (store.stats.correct||0) + (store.stats.wrong||0);
      store.stats.accuracy = tot ? ((store.stats.correct / tot)*100).toFixed(2) + "%" : "0.00%";
      // update algoStats for the algo used to make this prediction
      const algo = pred.algo || "ensemble";
      if (!store.algoStats[algo]) store.algoStats[algo] = { tested:0, correct:0 };
      store.algoStats[algo].tested = (store.algoStats[algo].tested || 0) + 1;
      if (pred.correct) store.algoStats[algo].correct = (store.algoStats[algo].correct||0) + 1;
    }
  }
  saveStore();
}

// create one prediction for next game using selected algorithm
function createPredictionForNext() {
  if (!store.history.length) return null;
  const latest = store.history[0];
  const raw = String(latest.gameNum).replace("#","");
  const nextNum = isNaN(Number(raw)) ? null : Number(raw)+1;
  const predictedFor = nextNum ? `#${nextNum}` : null;
  if (!predictedFor) return null;
  // avoid duplicate pending prediction
  const existing = store.predictions.find(p => p.predictedFor === predictedFor && p.evaluated === false);
  if (existing) return existing;

  // pick best algorithm dynamically
  const best = pickBestAlgo(); // returns algo name
  const out = (ALGO_MAP[best] || ALGO_MAP["ensemble"])(store.history);
  if (!out || out.prediction === "N/A") return null;

  const predObj = {
    predictedFor,
    predictedAt: latest.gameNum,
    algo: best,
    prediction: out.prediction,
    confidence: Math.round(out.confidence),
    evaluated: false,
    correct: null,
    createdAt: new Date().toISOString()
  };
  store.predictions.unshift(predObj);
  saveStore();
  return predObj;
}

// ---------- Main update loop ----------
async function updateLoop() {
  try {
    const res = await axios.get(API_URL, { timeout: 10000 });
    const list = res?.data?.data?.resultList;
    if (!Array.isArray(list) || list.length === 0) return;
    // add new history (dedup)
    const added = addHistoryEntries(list);
    if (added.length) {
      // evaluate predictions whose target results now available
      evaluatePredictionsForNewEntries(added);
    }
    // create prediction for next if none or refresh strategy
    createPredictionForNext();
  } catch (e) {
    console.error("updateLoop err:", e.message);
  }
}

// kickoff
updateLoop();
setInterval(updateLoop, UPDATE_INTERVAL);

// ---------- API endpoints (responses Vietnamese, algorithms hidden) ----------
app.get("/", (req,res) => {
  res.json({
    message: "Sicbo Sunwin Predictor v9.0 (Full) - tiếng Việt",
    endpoints: [
      { path:"/sicbosun/latest", desc:"Phiên mới nhất + dự đoán cho phiên kế tiếp" },
      { path:"/sicbosun/predictions", desc:"Danh sách predictions (ẩn chi tiết thuật toán)" },
      { path:"/sicbosun/history", desc:"Lịch sử phiên (mới nhất trước), param ?limit=50" },
      { path:"/sicbosun/algostats", desc:"Thống kê nội bộ của các thuật toán (dùng để debug) - nhẹ" }
    ],
    note: "Thuật toán và chi tiết nội bộ không hiển thị trong output prediction."
  });
});

// latest
app.get("/sicbosun/latest", (req,res) => {
  if (!store.history.length) return res.status(503).json({ error:"Dữ liệu đang tải..." });
  const latest = store.history[0];
  const raw = String(latest.gameNum).replace("#","");
  const nextNum = isNaN(Number(raw)) ? null : `#${Number(raw)+1}`;
  const pending = store.predictions.find(p => p.predictedFor === nextNum && p.evaluated === false) || null;

  res.json({
    phien_hien_tai: latest.gameNum,
    xuc_xac: latest.facesList || [],
    tong_diem: latest.score,
    ket_qua: latest.result,
    phien_tiep_theo: nextNum,
    du_doan_tiep_theo: pending ? pending.prediction : null,
    do_tin_cay: pending ? `${pending.confidence}%` : null,
    loai_cau_dang_dung: pending ? pending.algo : null, // algorithm name only (optional); remove if you want fully hidden
    thong_ke: {
      tong_phien_du_doan: store.stats.totalPredicted || 0,
      so_dung: store.stats.correct || 0,
      so_sai: store.stats.wrong || 0,
      ti_le_dung: store.stats.accuracy || "0.00%",
      chuoi_thang: store.stats.winStreak || 0
    },
    Dev: "@minhsangdangcap"
  });
});

// predictions list (sanitized)
app.get("/sicbosun/predictions", (req,res) => {
  const out = store.predictions.map(p => ({
    predicted_for: p.predictedFor,
    predicted_at: p.predictedAt,
    prediction: p.prediction,
    confidence: `${p.confidence}%`,
    evaluated: p.evaluated,
    correct: p.evaluated ? !!p.correct : null,
    algo: p.algo, // algorithm name kept, but if you want to hide, remove this line
    createdAt: p.createdAt,
    evaluatedAt: p.evaluatedAt || null
  }));
  res.json({ predictions: out });
});

// history
app.get("/sicbosun/history", (req,res) => {
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit) || 50));
  res.json({
    total_history: store.history.length,
    data: store.history.slice(0, limit)
  });
});

// algo stats (internal) - optional endpoint for debugging / tuning
app.get("/sicbosun/algostats", (req,res) => {
  res.json({ algoStats: store.algoStats, note:"Dùng để xem hiệu năng từng thuật toán (debug)." });
});

// reset stats endpoint (safe) - optional, resets only stats and algoStats, keeps history and predictions
app.post("/sicbosun/stats/reset", (req,res) => {
  store.stats = { totalPredicted:0, correct:0, wrong:0, accuracy:"0.00%", winStreak:0 };
  store.algoStats = { recency:{tested:0,correct:0}, frequency:{tested:0,correct:0}, pattern:{tested:0,correct:0}, markov:{tested:0,correct:0}, ensemble:{tested:0,correct:0} };
  saveStore();
  res.json({ ok:true, message:"Đã reset thống kê (history giữ nguyên)." });
});

// start server
app.listen(PORT, () => {
  console.log(`🚀 Sicbo v9.0 running at http://localhost:${PORT}`);
  console.log(`Endpoint: /sicbosun/latest`);
});
