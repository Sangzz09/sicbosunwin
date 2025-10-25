import express from "express";
import axios from "axios";
import fs from "fs-extra";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;
const API_URL = 'https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=100&tableId=39791215743193&curPage=1';
const UPDATE_INTERVAL = 5000;

let historyData = [];
let lastPhien = null;

// --- Load history từ data.json ---
const DATA_FILE = "./data.json";
if (fs.existsSync(DATA_FILE)) {
  try {
    historyData = fs.readJSONSync(DATA_FILE);
    if (historyData.length > 0) lastPhien = historyData[0].gameNum;
  } catch {
    historyData = [];
  }
}

// --- Hàm lưu lịch sử ---
function saveData() {
  fs.writeJSONSync(DATA_FILE, historyData, { spaces: 2 });
}

// --- Lấy dữ liệu từ API ---
async function fetchLatestData() {
  try {
    const res = await axios.get(API_URL);
    if (res.data && res.data.data && res.data.data.resultList) {
      return res.data.data.resultList;
    }
    return [];
  } catch (err) {
    console.error("Lỗi khi lấy dữ liệu từ API gốc:", err.message);
    return null;
  }
}

// --- Cập nhật lịch sử ---
async function updateHistory() {
  const newDataList = await fetchLatestData();
  if (!newDataList) return;

  if (historyData.length === 0) {
    historyData = newDataList;
    saveData();
    console.log(`Khởi tạo lịch sử ${historyData.length} phiên`);
    return;
  }

  const latestKnown = historyData[0].gameNum;
  const lastKnownIndex = newDataList.findIndex(item => item.gameNum === latestKnown);

  if (lastKnownIndex > 0) {
    const newEntries = newDataList.slice(0, lastKnownIndex);
    historyData.unshift(...newEntries);
    saveData();
    console.log(`Cập nhật thêm ${newEntries.length} phiên mới`);
  }
}

// --- Xử lý Tài/Xỉu ---
function getTaiXiu(score) {
  if (score >= 4 && score <= 10) return "Xỉu";
  if (score >= 11 && score <= 17) return "Tài";
  return "N/A";
}

// --- Dự đoán Tài/Xỉu VIP ---
function advancedPredict(history) {
  const last5 = history.slice(0,5);
  let scoreTai = 0, scoreXiu = 0;

  if (last5.length >= 3) {
    const last3 = last5.slice(0,3);
    const countTai = last3.filter(h => getTaiXiu(h.score)==="Tài").length;
    const countXiu = last3.filter(h => getTaiXiu(h.score)==="Xỉu").length;
    if (countTai>=2) scoreTai+=0.3;
    if (countXiu>=2) scoreXiu+=0.3;
  }

  if (last5.length>=1) {
    const lastPhien = last5[0];
    if (getTaiXiu(lastPhien.score)==="Tài") scoreXiu+=0.2;
    else scoreTai+=0.2;
    if (lastPhien.score>=11) scoreTai+=0.3;
    else scoreXiu+=0.3;
  }

  const total = last5.length || 1;
  const totalTai = last5.filter(h => getTaiXiu(h.score)==="Tài").length;
  const totalXiu = last5.filter(h => getTaiXiu(h.score)==="Xỉu").length;
  if (totalTai/total>0.6) scoreTai+=0.2;
  if (totalXiu/total>0.6) scoreXiu+=0.2;

  const RESET_THRESHOLD = 5;
  const lastWrong = last5.filter(h=>h.prediction && getTaiXiu(h.score)!==h.prediction).length;
  if (lastWrong>=RESET_THRESHOLD) { scoreTai=0.5; scoreXiu=0.5; }

  const totalScore = scoreTai+scoreXiu||1;
  const probTai = (scoreTai/totalScore)*100;
  const probXiu = (scoreXiu/totalScore)*100;

  const prediction = probTai>probXiu?"Tài":"Xỉu";
  const confidence = Math.max(probTai,probXiu).toFixed(2);

  // --- Dự đoán Vi ---
  let lastTotals = history.slice(0,20).map(h=>h.score);
  let freq = {};
  lastTotals.forEach(t=>freq[t]=(freq[t]||0)+1);
  let sortedTotals = Object.keys(freq).map(Number).sort((a,b)=>freq[b]-freq[a]);
  while(sortedTotals.length<3){
    const val = prediction==="Tài"?Math.floor(Math.random()*(18-11+1))+11:Math.floor(Math.random()*(10-3+1))+3;
    if (!sortedTotals.includes(val)) sortedTotals.push(val);
  }
  const Vi = sortedTotals.slice(0,3);

  // Loại cầu
  let loaiCau="Sunwin";
  const last3 = history.slice(0,3);
  if (last3.length===3 && last3.every(h=>getTaiXiu(h.score)===getTaiXiu(last3[0].score))) loaiCau="Liên tục";
  const last5 = history.slice(0,5);
  if (last5.length===5 && last5.every((h,i,a)=>i===0 || getTaiXiu(h.score)!==getTaiXiu(a[i-1].score))) loaiCau="Đảo liên tục";

  return {prediction, confidence, Vi, loaiCau};
}

// --- API Endpoint ---

app.get('/', (req,res)=>{
  res.json({
    message:"Sunwin Sicbo API VIP",
    endpoints:[
      {method:"GET", path:"/api/sunwin/latest", description:"Phiên mới nhất + dự đoán tiếp theo"},
      {method:"GET", path:"/api/sunwin/history", description:"Lịch sử các phiên đã ghi lại"}
    ]
  });
});

app.get('/api/sunwin/latest', (req,res)=>{
  if (historyData.length===0) return res.status(503).json({error:"Dữ liệu đang tải, thử lại sau"});
  const latest = historyData[0];
  const nextGameNum = parseInt(latest.gameNum.replace('#',''))+1;
  const {prediction, confidence, Vi, loaiCau} = advancedPredict(historyData);

  const response = {
    phien: latest.gameNum,
    xuc_xac: latest.facesList,
    tong_diem: latest.score,
    ket_qua: getTaiXiu(latest.score),
    phien_tiep_theo: `#${nextGameNum}`,
    du_doan: prediction,
    do_tin_cay: `${confidence}%`,
    vi: Vi,
    loai_cau,
    Dev: "@minhsangdangcap"
  };

  // Gán dự đoán vào history để tính đúng/sai cho tỉ lệ
  latest.prediction = prediction;

  res.json(response);
});

app.get('/api/sunwin/history', (req,res)=>{
  if (historyData.length===0) return res.status(503).json({error:"Dữ liệu đang tải, thử lại sau"});
  const soDung = historyData.filter(h=>h.prediction && getTaiXiu(h.score)===h.prediction).length;
  const soSai = historyData.length - soDung;
  const tiLe = historyData.length>0?((soDung/historyData.length)*100).toFixed(2)+"%":"0%";

  res.json({
    total_phien: historyData.length,
    so_dung: soDung,
    so_sai: soSai,
    ti_le_chinh_xac: tiLe,
    data: historyData,
    Dev: "@minhsangdangcap"
  });
});

// --- Chạy Server ---
app.listen(PORT, ()=>{
  console.log(`Server chạy tại http://localhost:${PORT}`);
  updateHistory();
  setInterval(updateHistory, UPDATE_INTERVAL);
});
