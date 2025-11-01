// =======================================================
// SICBO SUNWIN PREDICTOR v10.0 (FULL)
// Dev: @minhsangdangcap
// Chạy: npm install && npm start
// =======================================================

import express from "express";
import axios from "axios";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

// === Cấu hình nguồn dữ liệu ===
// Nếu bạn có API khác, thay API_URL tương ứng
const API_URL =
  "https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=100&tableId=39791215743193&curPage=1";

const DATA_FILE = "./data.json";
const UPDATE_INTERVAL = 7000; // ms

// === Store persisted ===
let store = {
  history: [], // newest-first: { gameNum:"#123", score:14, facesList:[], time:"..." }
  predictions: [], // newest-first: { predictedFor:"#124", predictedAt:"#123", prediction:"Tài", confidence:85, vi:[..], loaiCau:"", evaluated:false, correct:null, createdAt:"" }
  stats: { total: 0, correct: 0, wrong: 0, accuracy: "0%", winStreak: 0 },
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
      // basic validation
      if (parsed && typeof parsed === "object") {
        store.history = parsed.history || store.history;
        store.predictions = parsed.predictions || store.predictions;
        store.stats = parsed.stats || store.stats;
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

// === Vị (vi) prediction phù hợp hướng Tài/Xỉu ===
function predictVi(history, prediction, window = 60) {
  if (!Array.isArray(history) || history.length === 0) {
    if (prediction === "Tài") return [13, 14, 15];
    if (prediction === "Xỉu") return [7, 8, 9];
    return [8, 9, 10];
  }

  const slice = history.slice(0, window);
  const freq = {};
  const filter =
    prediction === "Tài"
      ? (s) => s >= 11 && s <= 17
      : (s) => s >= 4 && s <= 10;

  slice.forEach((h) => {
    const s = Number(h.score) || 0;
    if (!filter(s)) return;
    freq[s] = (freq[s] || 0) + 1;
  });

  const sorted = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .map((x) => Number(x[0]));

  if (sorted.length >= 3) return sorted.slice(0, 3);

  // fallback
  if (prediction === "Tài") return [13, 14, 15];
  if (prediction === "Xỉu") return [7, 8, 9];
  return [8, 9, 10];
}

// === Loại cầu phát hiện (nâng cao) ===
function detectCau(history) {
  const seq = history.slice(0, 8).map((h) => getTaiXiu(h.score));
  const joined = seq.join("");

  if (seq.length >= 6 && seq.every((v) => v === seq[0])) return "Cầu bệt dài";
  if (/^(TàiXỉu){3,}|(XỉuTài){3,}/.test(joined)) return "Cầu 1–1 (đảo liên tục)";
  if (/TàiTàiTàiXỉuXỉuXỉu/.test(joined)) return "Cầu 3–3";
  if (/TàiTàiXỉuTàiTài/.test(joined) || /XỉuXỉuTàiXỉuXỉu/.test(joined))
    return "Cầu 2–1–2";
  if (/TàiTàiTàiTàiXỉuXỉu/.test(joined)) return "Cầu 4–2";
  if (/Tài{5,}/.test(joined)) return "Cầu Tài mạnh";
  if (/Xỉu{5,}/.test(joined)) return "Cầu Xỉu mạnh";

  const tai = seq.filter((x) => x === "Tài").length;
  const xiu = seq.filter((x) => x === "Xỉu").length;
  if (tai === xiu) return "Cầu cân bằng";
  if (Math.abs(tai - xiu) >= 4) return "Cầu lệch mạnh";
  return "Cầu trung bình";
}

// === Thuật toán dự đoán (internal) ===
// Recency, Frequency, Pattern, Ensemble — trả prediction + confidence + vi (gợi ý)
function algoRecency(history) {
  const recent = history.slice(0, 6);
  const tai = recent.filter((h) => getTaiXiu(h.score) === "Tài").length;
  const xiu = recent.length - tai;
  const pred = tai > xiu ? "Tài" : "Xỉu";
  const conf = Math.min(99, 60 + Math.abs(tai - xiu) * 10);
  const vi = predictVi(history, pred, 40);
  return { prediction: pred, confidence: conf, vi };
}
function algoFrequency(history) {
  const window = 40;
  const slice = history.slice(0, window);
  const freq = {};
  slice.forEach((h) => (freq[h.score] = (freq[h.score] || 0) + 1));
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return { prediction: "N/A", confidence: 0, vi: [] };
  const top = Number(sorted[0][0]);
  const pred = getTaiXiu(top);
  const conf = Math.min(95, 45 + (sorted[0][1] / slice.length) * 55);
  const vi = sorted.slice(0, 3).map((x) => Number(x[0]));
  return { prediction: pred, confidence: conf, vi };
}
function algoPattern(history) {
  const seq = history.slice(0, 8).map((h) => getTaiXiu(h.score));
  const p4 = seq.slice(0, 4).join(",");
  if (p4 === "Tài,Xỉu,Tài,Xỉu" || p4 === "Xỉu,Tài,Xỉu,Tài") {
    const pred = seq[0] === "Tài" ? "Xỉu" : "Tài";
    const vi = predictVi(history, pred, 40);
    return { prediction: pred, confidence: 86, vi };
  }
  // detect 2-2 pattern
  if (seq[0] && seq[1] && seq[0] === seq[1] && seq[2] === seq[3] && seq[0] !== seq[2]) {
    const pred = seq[0] === "Tài" ? "Xỉu" : "Tài";
    const vi = predictVi(history, pred, 40);
    return { prediction: pred, confidence: 84, vi };
  }
  // fallback: small confidence opposite last
  const pred = seq[0] === "Tài" ? "Xỉu" : "Tài";
  const vi = predictVi(history, pred, 40);
  return { prediction: pred, confidence: 60, vi };
}
function algoEnsemble(history) {
  const a1 = algoRecency(history);
  const a2 = algoFrequency(history);
  const a3 = algoPattern(history);

  const algos = [ {out:a1, w:1.1}, {out:a2, w:1.0}, {out:a3, w:1.2} ];
  const votes = { "Tài":0, "Xỉu":0 };
  const vis = {};
  for (const a of algos) {
    if (!a.out || !a.out.prediction || a.out.prediction === "N/A") continue;
    votes[a.out.prediction] += (a.out.confidence/100) * a.w;
    if (Array.isArray(a.out.vi)) {
      a.out.vi.forEach((v,i) => vis[v] = (vis[v]||0) + (a.out.confidence/100) * (1/(i+1)));
    }
  }
  const final = votes["Tài"] > votes["Xỉu"] ? "Tài" : "Xỉu";
  const diff = Math.abs(votes["Tài"] - votes["Xỉu"]);
  const conf = Math.min(99, 45 + (diff / (votes["Tài"] + votes["Xỉu"] || 1)) * 55);
  const viSorted = Object.entries(vis).sort((a,b)=>b[1]-a[1]).map(x=>Number(x[0])).slice(0,3);
  const vi = viSorted.length ? viSorted : predictVi(history, final, 40);
  return { prediction: final, confidence: Number(conf.toFixed(1)), vi };
}

// === Prediction lifecycle ===
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
  if (store.history.length > 1500) store.history = store.history.slice(0,1500);
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
      store.stats.total = (store.stats.total || 0) + 1;
      if (pred.correct) {
        store.stats.correct = (store.stats.correct || 0) + 1;
        store.stats.winStreak = (store.stats.winStreak || 0) + 1;
        store.wrongStreak = 0;
      } else {
        store.stats.wrong = (store.stats.wrong || 0) + 1;
        store.stats.winStreak = 0;
        store.wrongStreak = (store.wrongStreak || 0) + 1;
      }
      const tot = (store.stats.correct || 0) + (store.stats.wrong || 0);
      store.stats.accuracy = tot ? ((store.stats.correct / tot) * 100).toFixed(2) + "%" : "0.00%";
      // if fails many times in a row, reset internal wrongStreak and print
      if (store.wrongStreak >= 5) {
        console.log("⚠️ Sai liên tục >=5 lần — reset tạm bộ nhớ nội bộ");
        store.wrongStreak = 0;
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

  // use ensemble
  const out = algoEnsemble(store.history);
  if (!out || out.prediction === "N/A") return null;

  const loaiCau = detectCau(store.history);
  const vi = Array.isArray(out.vi) ? out.vi.slice(0,3) : predictVi(store.history, out.prediction, 40);

  const predObj = {
    predictedAt: latest.gameNum,
    predictedFor,
    algo: "ensemble",
    prediction: out.prediction,
    confidence: Math.round(out.confidence),
    vi,
    loaiCau,
    evaluated: false,
    createdAt: new Date().toISOString()
  };
  store.predictions.unshift(predObj);
  saveStore();
  return predObj;
}

// === Main update loop ===
async function updateLoop() {
  try {
    const res = await axios.get(API_URL, { timeout: 10000 });
    const list = res?.data?.data?.resultList;
    if (!Array.isArray(list) || list.length === 0) return;
    const added = addHistoryEntries(list);
    if (added.length) evaluatePredictionsForNewEntries(added);
    createPredictionIfNeeded();
  } catch (e) {
    console.error("updateLoop error:", e.message);
  }
}
updateLoop();
setInterval(updateLoop, UPDATE_INTERVAL);

// === API endpoints (tiếng Việt) ===
app.get("/", (req,res) => {
  res.json({
    message: "Sicbo Sunwin Predictor v10.0",
    endpoints: [
      "/sicbosun/latest",
      "/sicbosun/predictions",
      "/sicbosun/history",
      "/sicbosun/algostats (optional)"
    ],
    note: "Thuật toán nội bộ ẩn; JSON trả thông tin cần dùng."
  });
});

app.get("/sicbosun/latest", (req, res) => {
  if (!store.history.length) return res.status(503).json({ error: "Dữ liệu đang tải..." });
  const latest = store.history[0];
  const raw = String(latest.gameNum).replace("#", "");
  const next = isNaN(Number(raw)) ? null : `#${Number(raw)+1}`;
  const pending = store.predictions.find(p => p.predictedFor === next && p.evaluated === false) || null;

  res.json({
    "Phiên hiện tại": latest.gameNum,
    "Xúc xắc": latest.facesList || [],
    "Tổng điểm": latest.score,
    "Kết quả": getTaiXiu(latest.score),
    "Phiên tiếp theo": next,
    "Dự đoán": pending ? pending.prediction : null,
    "Độ tin cậy": pending ? `${pending.confidence}%` : null,
    "Loại cầu": pending ? pending.loaiCau : null,
    "Vị dự đoán": pending ? pending.vi : null,
    "Thống kê": {
      "Tổng dự đoán": store.stats.total || 0,
      "Số đúng": store.stats.correct || 0,
      "Số sai": store.stats.wrong || 0,
      "Tỉ lệ đúng": store.stats.accuracy || "0.00%",
      "Chuỗi thắng": store.stats.winStreak || 0
    },
    Dev: "@minhsangdangcap"
  });
});

app.get("/sicbosun/predictions", (req,res) => {
  const out = store.predictions.map(p => ({
    predicted_for: p.predictedFor,
    predicted_at: p.predictedAt,
    prediction: p.prediction,
    confidence: `${p.confidence}%`,
    vi: p.vi || [],
    loaiCau: p.loaiCau || null,
    evaluated: p.evaluated,
    correct: p.evaluated ? !!p.correct : null,
    createdAt: p.createdAt,
    evaluatedAt: p.evaluatedAt || null
  }));
  res.json({ total: out.length, predictions: out });
});

app.get("/sicbosun/history", (req,res) => {
  const limit = Math.max(1, Math.min(200, parseInt(req.query.limit) || 50));
  res.json({
    total_history: store.history.length,
    data: store.history.slice(0, limit)
  });
});

// optional: algorithm internal stats (debug)
app.get("/sicbosun/algostats", (req,res) => {
  res.json({ note: "Optional debug", wrongStreak: store.wrongStreak, stats: store.stats });
});

// start server
app.listen(PORT, () => {
  console.log(`🚀 Sicbo Predictor v10.0 chạy tại http://localhost:${PORT}`);
  console.log(`Endpoint: /sicbosun/latest`);
});
