const http = require('http');
const fs = require('fs');
const path = require('path');
const {URL} = require('url');
const crypto = require('crypto');

let win
let db
// 创建服务
const server = http.createServer((req, res) => {
    const secret = req.headers['mwfh-secret'];
    const s1 = md5('Hua' + db.data.secret + getNowMin())
    const s2 = md5('Hua' + db.data.secret + getPrevMin())
    const s3 = md5('Hua' + getPrevMin()) // unset
    if(secret !== s1 && secret !== s2 && secret !== s3) {
        res.writeHead(403)
        res.end(JSON.stringify({code: 403}))
        return
    }
    // req：请求对象，res：响应对象
    // 设置响应头：返回json，编码utf8
    res.setHeader('Content-Type', 'application/json;charset=utf-8')
    const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
    if (pathname === '/' && req.method === 'GET') {
        const params = parseGetParams(req)
        const trace = {
            "time": new Date().toLocaleString('zh-CN'),
            "target": params.name,
            "msg": "接收到新文字信息：" + params.data,
            "type": "log-succ"
        }
        win.webContents.send('trace-show', trace)
        res.end(JSON.stringify({code: 200}))
    } else if (pathname === '/' && req.method === 'POST') {
        savePostFile(req, db.data.saveFolderPath).then((result) => {
            const nodeName = result.fields.name
            const trace = {
                "time": new Date().toLocaleString('zh-CN'),
                "target": nodeName,
                "msg": "接收到新文件：" + result.fields.fileName,
                "type": "log-succ"
            }
            win.webContents.send('trace-show', trace)
            res.end(JSON.stringify({code: 200}))
        })
    } else {
        res.writeHead(404)
        res.end(JSON.stringify({code: 404}))
    }
})

/**
 * 1. 客户端：发送 GET 请求
 * @param {string} baseUrl 基础地址，例如 http://192.168.1.1:8080/api/text
 * @param {object} params 参数对象，自动转为 query 拼接
 * @returns {Promise<any>} 响应结果，自动尝试解析 JSON
 */
function sendGet(secret, baseUrl, params = {}) {
    return new Promise((resolve, reject) => {
        // 内部自动把对象转为 query 参数，拼到 URL 上
        const urlObj = new URL(baseUrl);
        Object.entries(params).forEach(([key, value]) => {
            urlObj.searchParams.set(key, String(value));
        });
        const opt = {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname + urlObj.search,
          method: "GET",
          headers: {
            'Mwfh-Secret': md5('Hua' + secret + getNowMin())
          }
        };
        const req = http.get(opt, (res) => {
            let rawData = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => rawData += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(rawData));
                } catch {
                    resolve(rawData);
                }
            });
            if(res.statusCode !== 200){
              reject(new Error('文字发送错误：' + res.statusCode));
            }
        });

        req.on('error', reject);
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('文字发送超时'));
        });
    });
}

/**
 * 2. 服务端：解析 GET 请求的 query 参数为对象
 * @param {http.IncomingMessage} req http 请求实例
 * @returns {object} 解析后的参数对象
 */
function parseGetParams(req) {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const params = {};
    urlObj.searchParams.forEach((value, key) => {
        params[key] = value;
    });
    return params;
}

/**
 * 3. 客户端：发送 POST 请求，上传单个文件 + 附带普通表单参数
 * @param {string} url 上传接口地址
 * @param {string} filePath 本地文件绝对路径
 * @param {object} extraFields 额外的普通表单参数（对象形式）
 * @param {string} fieldName 表单文件字段名，默认 file
 * @returns {Promise<any>} 响应结果
 */
function sendPostFile(secret, url, filePath, extraFields = {}, fieldName = 'file') {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const fileName = path.basename(filePath);
        const boundary = `NodeFileBoundary_${Date.now()}`;
        let host = urlObj.hostname
        if (host.startsWith('[') && host.endsWith(']')) {
            host = host.slice(1, -1);
        }
        const options = {
            hostname: host,
            port: urlObj.port || 80,
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Mwfh-Secret': md5('Hua' + secret + getNowMin())
            }
        };
        const req = http.request(options, (res) => {
            let rawData = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => rawData += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(rawData));
                } catch {
                    resolve(rawData);
                }
            });
            if(res.statusCode !== 200){
              reject(new Error('文件传输错误：' + res.statusCode));
            }
        });

        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('文件上传超时'));
        });

        // ========== 新增：先写入所有普通表单字段 ==========
        Object.entries(extraFields).forEach(([key, value]) => {
            req.write(`--${boundary}\r\n`);
            req.write(`Content-Disposition: form-data; name="${key}"\r\n\r\n`);
            req.write(`${String(value)}\r\n`);
        });

        // 再写入文件表单头
        req.write(`--${boundary}\r\n`);
        req.write(
            `Content-Disposition: form-data; name="${fieldName}"; filename="${encodeURIComponent(fileName)}"\r\n`
        );
        req.write('Content-Type: application/octet-stream\r\n\r\n');

        // 以流的方式写入文件，避免大文件占内存
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(req, {end: false});
        fileStream.on('end', () => {
            req.write(`\r\n--${boundary}--\r\n`);
            req.end();
        });
        fileStream.on('error', (err) => {
            req.destroy();
            reject(err);
        });
    });
}

/**
 * 4. 服务端：接收 POST 请求，解析普通表单参数 + 保存文件
 * @param {http.IncomingMessage} req http 请求实例
 * @param {string} saveDir 保存目录
 * @returns {Promise<{fileName:string, filePath:string, size:number, fields:object}>}
 */
function savePostFile(req, saveDir) {
    return new Promise((resolve, reject) => {
        // 自动创建保存目录
        if (!fs.existsSync(saveDir)) {
            fs.mkdirSync(saveDir, {recursive: true});
        }

        // 从请求头提取分隔符
        const contentType = req.headers['content-type'] || '';
        const boundaryMatch = contentType.match(/boundary=([^;]+)/);
        if (!boundaryMatch) {
            return reject(new Error('请求格式错误，非文件上传请求'));
        }
        const boundary = Buffer.from('--' + boundaryMatch[1].trim());

        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const fields = {}; // 存放普通表单参数
            let fileResult = null;

            // 按分隔符切割所有表单部分
            const parts = splitBuffer(buffer, boundary);

            parts.forEach(part => {
                // 跳过空片段和结束标记
                if (part.length === 0 || part.toString().startsWith('--')) return;
                // 去掉开头的换行符
                if (part[0] === 0x0d && part[1] === 0x0a) part = part.slice(2);

                // 分割头部和内容
                const headerEnd = part.indexOf('\r\n\r\n');
                if (headerEnd === -1) return;

                const headerStr = part.slice(0, headerEnd).toString();
                const body = part.slice(headerEnd + 4);

                // 提取字段名
                const nameMatch = headerStr.match(/name="([^"]+)"/);
                if (!nameMatch) return;
                const fieldName = nameMatch[1];

                // 提取文件名（有文件名说明是文件字段）
                const fileNameMatch = headerStr.match(/filename="([^"]+)"/);

                if (fileNameMatch) {
                    // 处理文件字段
                    const fileName = decodeURIComponent(fileNameMatch[1]);
                    // 去掉内容末尾的换行符
                    const fileContent = body.slice(0, body.length - 2);
                    const savePath = path.join(saveDir, fileName);
                    fs.writeFileSync(savePath, fileContent);

                    fileResult = {
                        fileName,
                        filePath: savePath,
                        size: fileContent.length
                    };
                } else {
                    // 处理普通表单字段
                    fields[fieldName] = body.toString('utf8').trim();
                }
            });

            if (!fileResult) {
                return reject(new Error('未解析到上传文件'));
            }

            // 返回文件信息 + 普通参数
            resolve({
                ...fileResult,
                fields
            });
        });

        req.on('error', reject);
    });
}

// 辅助方法：按分隔符切割 Buffer
function splitBuffer(buffer, separator) {
    const parts = [];
    let offset = 0;
    let index;
    while ((index = buffer.indexOf(separator, offset)) !== -1) {
        parts.push(buffer.slice(offset, index));
        offset = index + separator.length;
    }
    parts.push(buffer.slice(offset));
    return parts;
}


function start(mainWin, mainDb, args) {
    const mainPort = args.port
    win = mainWin
    db = mainDb
    let port = 5216
    if (mainPort) {
        port = Number(mainPort)
    }
    if(server){
        server.close((err) => {
          let msg
          let type
          if (err) {
            msg = '关闭失败：' + err.message
            type = 'log-succ'
          } else {
            msg = '传输服务已停止'
            type = 'log-err'
          }
          const trace = {
              "time": new Date().toLocaleString('zh-CN'),
              "target": '系统',
              "msg": msg,
              "type": type
          }
          win.webContents.send('trace-show', trace)
        });
    }
    server.listen(port, () => {
        const trace = {
            "time": new Date().toLocaleString('zh-CN'),
            "target": '系统',
            "msg": `服务启动成功：http://localhost:${port}`,
            "type": "log-succ"
        }
        setTimeout(() => {
            win.webContents.send('trace-show', trace)
        }, 5000);
    })
}

function getTimeToMinNoSep(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  const h = String(dateObj.getHours()).padStart(2, '0');
  const mi = String(dateObj.getMinutes()).padStart(2, '0');
  return `${y}${m}${day}${h}${mi}`;
}

// 获取当前时间（当前分）
function getNowMin() {
  return getTimeToMinNoSep(new Date());
}

// 获取前一分钟
function getPrevMin() {
  const prev = new Date(Date.now() - 60 * 1000);
  return getTimeToMinNoSep(prev);
}


/**
 * 普通MD5加密
 * @param {string} str 原始字符串
 * @returns {string} 32位小写MD5
 */
function md5(str) {
  return crypto.createHash('md5')
    .update(str, 'utf8')
    .digest('hex');
}

module.exports = {
    start,
    sendGet,
    sendPostFile
}