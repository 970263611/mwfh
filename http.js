const http = require('http');
const fs = require('fs');
const path = require('path');
const {URL} = require('url');
const crypto = require('crypto');

// 全局引用，由 start() 初始化
let win, db, args;

/**
 * HTTP 服务端
 * 处理三类请求：
 *   GET  /  - 文字消息
 *   POST /  - 文件上传
 *   PUT  /  - RTC 信令
 */
const server = http.createServer((req, res) => {
    // 从请求头取密钥
    const secret = req.headers['mwfh-secret'];

    // 计算当前/前一分钟的合法密钥（允许 ±1 分钟时钟差）
    const s1 = md5('Hua' + db.data.secret + getNowMin());
    const s2 = md5('Hua' + db.data.secret + getPrevMin());

    // 鉴权：本机密钥非空时校验
    if (secret !== s1 && secret !== s2 && db.data.secret !== '') {
        res.writeHead(403);
        res.end(JSON.stringify({code: 403}));
        return;
    }

    res.setHeader('Content-Type', 'application/json;charset=utf-8');
    const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;

    // GET - 接收文字消息
    if (pathname === '/' && req.method === 'GET') {
        const params = parseGetParams(req);
        win.webContents.send('trace-show', {
            time: new Date().toLocaleString('zh-CN'),
            target: params.name,
            msg: '接收到新文字信息：' + params.data,
            type: 'log-succ'
        });
        res.end(JSON.stringify({code: 200}));
    }
    // POST - 接收文件上传
    else if (pathname === '/' && req.method === 'POST') {
        savePostFile(req, db.data.saveFolderPath).then(result => {
            win.webContents.send('trace-show', {
                time: new Date().toLocaleString('zh-CN'),
                target: result.fields.name,
                msg: '接收到新文件：' + result.fields.fileName,
                type: 'log-succ'
            });
            res.end(JSON.stringify({code: 200}));
        }).catch(err => {
            res.writeHead(500);
            res.end(JSON.stringify({code: 500, msg: err.message}));
        });
    }
    // PUT - 接收 RTC 信令
    else if (pathname === '/' && req.method === 'PUT') {
        const type = req.headers['mwfh-rtc-type'];
        const remotePort = req.headers['mwfh-my-port'];
        const remoteSecret = req.headers['mwfh-my-secret'];

        let bodyBuf = [];
        req.on('data', chunk => bodyBuf.push(chunk));
        req.on('end', () => {
            try {
                const payload = JSON.parse(Buffer.concat(bodyBuf).toString('utf8'));

                // 拼接对方完整地址（IPv6 加方括号）
                let remoteAddr;
                if (req.socket.remoteAddress) {
                    remoteAddr = req.socket.remoteAddress.includes(':')
                        ? '[' + req.socket.remoteAddress + ']:' + remotePort
                        : req.socket.remoteAddress + ':' + remotePort;
                }
                payload.addr = remoteAddr;
                payload.secret = remoteSecret;

                win.webContents.send('trace-show', {
                    time: new Date().toLocaleString('zh-CN'),
                    target: payload.name,
                    msg: `收到RTC[${type}]指令：${JSON.stringify(payload.data)}`,
                    type: 'log-succ'
                });

                // 分发给渲染进程对应事件
                if (type === 'offer') {
                    win.webContents.send('rtc-recv', JSON.stringify(payload));
                } else if (type === 'answer') {
                    win.webContents.send('rtc-callback', JSON.stringify(payload));
                }

                res.end(JSON.stringify({code: 200}));
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({code: 500, msg: e.message}));
            }
        });
        req.on('error', err => {
            res.writeHead(500);
            res.end(JSON.stringify({code: 500, msg: err.message}));
        });
    }
    // 其他路径返回 404
    else {
        res.writeHead(404);
        res.end(JSON.stringify({code: 404}));
    }
});

/**
 * 发送 GET 请求（文字消息）
 * @param {string} secret - 对方密钥
 * @param {string} baseUrl - 对方地址
 * @param {object} params - 查询参数
 * @returns {Promise<any>} 响应数据
 */
function sendGet(secret, baseUrl, params = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(baseUrl);
        Object.entries(params).forEach(([k, v]) => urlObj.searchParams.set(k, String(v)));

        let host = urlObj.hostname;
        if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);

        const req = http.get({
            hostname: host,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {'Mwfh-Secret': md5('Hua' + secret + getNowMin())}
        }, res => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', c => raw += c);
            res.on('end', () => {
                try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
            });
            if (res.statusCode !== 200) reject(new Error('文字发送错误：' + res.statusCode));
        });

        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('文字发送超时')); });
    });
}

/**
 * 发送 PUT 请求（RTC 信令）
 * @param {string} secret - 对方密钥
 * @param {string} url - 对方地址
 * @param {string} type - offer / answer
 * @param {object} payload - 数据
 * @returns {Promise<any>} 响应数据
 */
function sendPutRtc(secret, url, type, payload = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const body = JSON.stringify(payload);

        let host = urlObj.hostname;
        if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);

        const req = http.request({
            hostname: host,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json;charset=utf-8',
                'Content-Length': Buffer.byteLength(body),
                'Mwfh-Secret': md5('Hua' + secret + getNowMin()),
                'Mwfh-My-Secret': db.data.secret,
                'Mwfh-Rtc-Type': type,
                'Mwfh-My-Port': args.port
            }
        }, res => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', c => raw += c);
            res.on('end', () => {
                try {
                    const json = JSON.parse(raw);
                    if (res.statusCode !== 200) {
                        reject(new Error(`RTC传输错误：${res.statusCode} ${json.msg || ''}`));
                        return;
                    }
                    resolve(json);
                } catch {
                    if (res.statusCode !== 200) reject(new Error(`RTC传输错误：${res.statusCode}`));
                    else resolve(raw);
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('RTC请求超时，请检查地址是否变化'));
        });

        req.write(body);
        req.end();
    });
}

/**
 * 解析 GET 请求的 query 参数
 * @param {http.IncomingMessage} req
 * @returns {object}
 */
function parseGetParams(req) {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const params = {};
    urlObj.searchParams.forEach((v, k) => params[k] = v);
    return params;
}

/**
 * 发送 POST 请求（文件上传，multipart/form-data）
 * @param {string} secret - 对方密钥
 * @param {string} url - 对方地址
 * @param {string} filePath - 本地文件路径
 * @param {object} extraFields - 额外表单参数
 * @param {string} fieldName - 文件字段名，默认 'file'
 * @returns {Promise<any>}
 */
function sendPostFile(secret, url, filePath, extraFields = {}, fieldName = 'file') {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const fileName = path.basename(filePath);
        const boundary = `NodeFileBoundary_${Date.now()}`;

        let host = urlObj.hostname;
        if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);

        const req = http.request({
            hostname: host,
            port: urlObj.port || 80,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Mwfh-Secret': md5('Hua' + secret + getNowMin())
            }
        }, res => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', c => raw += c);
            res.on('end', () => {
                try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
            });
            if (res.statusCode !== 200) reject(new Error('文件传输错误：' + res.statusCode));
        });

        req.on('error', reject);
        req.setTimeout(300000, () => { req.destroy(); reject(new Error('文件上传超时')); });

        // 写入普通表单字段
        Object.entries(extraFields).forEach(([k, v]) => {
            req.write(`--${boundary}\r\n`);
            req.write(`Content-Disposition: form-data; name="${k}"\r\n\r\n`);
            req.write(`${String(v)}\r\n`);
        });

        // 写入文件字段头
        req.write(`--${boundary}\r\n`);
        req.write(`Content-Disposition: form-data; name="${fieldName}"; filename="${encodeURIComponent(fileName)}"\r\n`);
        req.write('Content-Type: application/octet-stream\r\n\r\n');

        // 流式写入文件内容，避免大文件占内存
        const stream = fs.createReadStream(filePath);
        stream.pipe(req, {end: false});
        stream.on('end', () => {
            req.write(`\r\n--${boundary}--\r\n`);
            req.end();
        });
        stream.on('error', err => { req.destroy(); reject(err); });
    });
}

/**
 * 接收并保存上传的文件（解析 multipart/form-data）
 * @param {http.IncomingMessage} req
 * @param {string} saveDir - 保存目录
 * @returns {Promise<{fileName, filePath, size, fields}>}
 */
function savePostFile(req, saveDir) {
    return new Promise((resolve, reject) => {
        // 自动创建目录
        if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, {recursive: true});

        // 提取分隔符
        const ct = req.headers['content-type'] || '';
        const m = ct.match(/boundary=([^;]+)/);
        if (!m) return reject(new Error('请求格式错误，非文件上传请求'));
        const boundary = Buffer.from('--' + m[1].trim());

        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const buf = Buffer.concat(chunks);
            const fields = {};
            let fileResult = null;

            // 按分隔符切割
            const parts = splitBuffer(buf, boundary);
            parts.forEach(part => {
                if (part.length === 0) return;
                // 结束标记以 -- 开头（直接检查字节，不转字符串，避免大文件性能问题）
                if (part.length >= 2 && part[0] === 0x2d && part[1] === 0x2d) return;
                // 去掉开头的 \r\n
                if (part[0] === 0x0d && part[1] === 0x0a) part = part.slice(2);

                const headerEnd = part.indexOf('\r\n\r\n');
                if (headerEnd === -1) return;

                const headerStr = part.slice(0, headerEnd).toString();
                const body = part.slice(headerEnd + 4);

                const nameM = headerStr.match(/name="([^"]+)"/);
                if (!nameM) return;
                const fieldName = nameM[1];

                const fileM = headerStr.match(/filename="([^"]+)"/);
                if (fileM) {
                    // 文件字段
                    const fileName = decodeURIComponent(fileM[1]);
                    const content = body.slice(0, body.length - 2); // 去掉末尾 \r\n
                    const savePath = path.join(saveDir, fileName);
                    fs.writeFileSync(savePath, content);
                    fileResult = {fileName, filePath: savePath, size: content.length};
                } else {
                    // 普通字段
                    fields[fieldName] = body.toString('utf8').trim();
                }
            });

            if (!fileResult) return reject(new Error('未解析到上传文件'));
            resolve({...fileResult, fields});
        });

        req.on('error', reject);
    });
}

/**
 * 按分隔符切割 Buffer（类似 String.split）
 * @param {Buffer} buffer
 * @param {Buffer} separator
 * @returns {Buffer[]}
 */
function splitBuffer(buffer, separator) {
    const parts = [];
    let offset = 0, idx;
    while ((idx = buffer.indexOf(separator, offset)) !== -1) {
        parts.push(buffer.slice(offset, idx));
        offset = idx + separator.length;
    }
    parts.push(buffer.slice(offset));
    return parts;
}

/**
 * 启动 HTTP 服务
 * @param {object} mainWin - 主窗口
 * @param {object} mainDb - 数据库
 * @param {object} mainArgs - 启动参数
 */
function start(mainWin, mainDb, mainArgs) {
    args = mainArgs;
    win = mainWin;
    db = mainDb;

    // 端口号，默认 5216
    let port = mainArgs.port ? Number(mainArgs.port) : 5216;
    if (!mainArgs.port) args.port = port;

    // 重启服务
    if (server) {
        server.close(err => {
            win.webContents.send('trace-show', {
                time: new Date().toLocaleString('zh-CN'),
                target: '系统',
                msg: err ? '关闭失败：' + err.message : '传输服务已停止',
                type: err ? 'log-succ' : 'log-err'
            });
        });
    }

    server.listen(port, () => {
        // 延迟通知，等页面加载完成
        setTimeout(() => {
            win.webContents.send('trace-show', {
                time: new Date().toLocaleString('zh-CN'),
                target: '系统',
                msg: `服务启动成功：http://localhost:${port}`,
                type: 'log-succ'
            });
        }, 3000);
    });
}

/**
 * 日期格式化为 "年月日时分"（无分隔符），用于分钟级密钥
 * @param {Date} d
 * @returns {string}
 */
function getTimeToMinNoSep(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${y}${m}${day}${h}${mi}`;
}

/** 当前分钟时间字符串 */
function getNowMin() { return getTimeToMinNoSep(new Date()); }

/** 前一分钟时间字符串 */
function getPrevMin() { return getTimeToMinNoSep(new Date(Date.now() - 60000)); }

/**
 * MD5 加密
 * @param {string} str
 * @returns {string} 32位小写
 */
function md5(str) {
    return crypto.createHash('md5').update(str, 'utf8').digest('hex');
}

module.exports = {start, sendGet, sendPostFile, sendPutRtc};
