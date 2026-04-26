const express = require("express");
const crypto = require("crypto");
const path = require("path");
const app = express();

app.use(express.json());

const cookies = [];
const qrMap = {};

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