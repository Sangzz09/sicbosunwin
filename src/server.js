import express from "express";
import axios from "axios";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

const API_URL = 'https://api.wsktnus8.net/v2/history/getLastResult?gameId=ktrng_3979&size=100&tableId=39791215743193&curPage=1';
const UPDATE_INTERVAL = 5000;
const DATA_FILE = "./data.json";

let historyData = [];
let lastPhien = null;

// --- Tạo data.json nếu chưa có ---
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf-8");

// --- Load history ---
try {
  historyData = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  if (historyData.length > 0) lastPhien = historyData[0].gameNum;
} catch {
  historyData = [];
}

// --- Lưu history ---
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(historyData, null, 2), "utf-8");
}

// --- Lấy dữ liệu mới ---
async function fetchLatestData() {
  try {
    const res = await axios.get(API_URL);
    const list = res?.data?.data?.resultList;
    if (!list) return [];
    return list;
  } catch (err) {
    console.error("Lỗi khi fetch API:", err.message);
    return null;
  }
}

// --- Cập nhật history ---
async function updateHistory() {
  const newData = await fetchLatestData();
  if (!newData) return;

  if (historyData.length === 0) {
    historyData = newData;
    saveData();
    console.log(`Khởi tạo ${historyData.length} phiên`);
    return;
  }

  const latestKnown = historyData[0].gameNum;
  const index = newData.findIndex(x => x.gameNum === latestKnown);
  if (index > 0) {
    const newEntries = newData.slice(0, index);
    historyData.unshift(...newEntries);
    saveData();
    console.log(`Cập nhật thêm ${newEntries.length} phiên`);
  }
}

// --- Tài/Xỉu ---
function getTaiXiu(score) {
  if (score >= 4 && score <= 10) return "Xỉu";
  if (score >= 11 && score <= 17) return "Tài";
  return "N/A";
}

// --- Dự đoán đơn giản (VIP có thể nâng cao sau) ---
function predictNext(history) {
  const last5 = history.slice(0,5);
  let scoreTai=0, scoreXiu=0;
  last5.forEach(h=>{
    const r = getTaiXiu(h.score);
    if (r==="Tài") scoreTai+=1;
    if (r==="Xỉu") scoreXiu+=1;
  });
  const prediction = scoreTai>=scoreXiu?"Tài":"Xỉu";
  const confidence = Math.max(scoreTai,scoreXiu)/last5.length*100;

  // Vi: 3 tổng dự đoán
  const lastTotals = history.slice(0,20).map(h=>h.score);
  let Vi = Array.from(new Set(lastTotals)).slice(0,3);
  while(Vi.length<3){
    const val = prediction==="Tài"?Math.floor(Math.random()*8)+11:Math.floor(Math.random()*8)+3;
    if (!Vi.includes(val)) Vi.push(val);
  }

  // Loại cầu
  let loaiCau="Sunwin";
  const last3 = history.slice(0,3);
  if (last3.length===3 && last3.every(h=>getTaiXiu(h.score)===getTaiXiu(last3[0].score))) loaiCau="Liên tục";
  const last5Check = history.slice(0,5);
  if (last5Check.length===5 && last5Check.every((h,i,a)=>i===0||getTaiXiu(h.score)!==getTaiXiu(a[i-1].score))) loaiCau="Đảo liên tục";

  return {prediction, confidence:confidence.toFixed(2), Vi, loaiCau};
}

// --- API ---
app.get('/', (req,res)=>{
  res.json({
    message:"Sunwin API",
    endpoints:[
      {path:"/api/sunwin/latest", description:"Phiên mới nhất + dự đoán"},
      {path:"/api/sunwin/history", description:"Lịch sử phiên"}
    ]
  });
});

app.get('/api/sunwin/latest', (req,res)=>{
  if (historyData.length===0) return res.status(503).json({error:"Dữ liệu đang tải"});
  const latest = historyData[0];
  const nextPhien = parseInt(latest.gameNum.replace('#',''))+1;
  const {prediction, confidence, Vi, loaiCau} = predictNext(historyData);
  latest.prediction = prediction;

  res.json({
    phien: latest.gameNum,
    xuc_xac: latest.facesList||[],
    tong_diem: latest.score||0,
    ket_qua: getTaiXiu(latest.score),
    phien_tiep_theo: `#${nextPhien}`,
    du_doan: prediction,
    do_tin_cay: `${confidence}%`,
    vi: Vi,
    loai_cau,
    Dev: "@minhsangdangcap"
  });
});

app.get('/api/sunwin/history', (req,res)=>{
  if (historyData.length===0) return res.status(503).json({error:"Dữ liệu đang tải"});
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
