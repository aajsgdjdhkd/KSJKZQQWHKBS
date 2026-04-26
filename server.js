const express = require("express");
const crypto = require("crypto");
const app = express();

app.use(express.json());

const cookies = [];
const qrMap = {}; // qrId -> { status, cookie }

app.get("/api/qr", (req, res) => {
    const qrId = crypto.randomUUID();
    const qrUrl = "https://v.kuaishou.com/" + crypto.randomBytes(4).toString("hex");
    
    qrMap[qrId] = { status: "wait", cookie: null, time: Date.now() };
    
    res.json({ qrId, qrUrl });
});

app.post("/api/submit", (req, res) => {
    const { qrId, cookie } = req.body;
    
    if (qrMap[qrId]) {
        qrMap[qrId].status = "ok";
        qrMap[qrId].cookie = cookie;
        cookies.push({ cookie, time: new Date().toISOString() });
    }
    
    res.json({ ok: true });
});

app.get("/api/check", (req, res) => {
    const { id } = req.query;
    const data = qrMap[id];
    
    if (!data) return res.json({ status: "expired" });
    
    res.json({ status: data.status, cookie: data.cookie });
});

app.get("/api/cookies", (req, res) => {
    res.json(cookies.slice(-50).reverse());
});

app.listen(3000);