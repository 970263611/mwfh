const {dialog, ipcMain, shell, screen, app} = require('electron');
const path = require('node:path');
const os = require('os');
const fs = require('fs');
const http = require('./http');
const ip = require('./ip.js');
const nut = require('./nut.js');

// 全局引用，由 start() 初始化
let win, db, appArgs, ipv6;

// ========== 节点管理 ==========

/** 添加/更新节点（按名称匹配） */
ipcMain.on('addNode', async (event, node) => {
    const saveNode = db.data.nodes.find(n => n.name === node.name);
    if (saveNode) {
        saveNode.name = node.name;
        saveNode.addr = node.addr;
    } else {
        db.data.nodes.push(node);
    }
    await db.write();
});

/** 更新节点（含密钥字段） */
ipcMain.on('updateNode', async (event, node) => {
    const saveNode = db.data.nodes.find(n => n.name === node.name);
    if (saveNode) {
        saveNode.name = node.name;
        saveNode.addr = node.addr;
        saveNode.secret = node.secret;
    } else {
        db.data.nodes.push(node);
    }
    await db.write();
});

/** 删除节点（按名称） */
ipcMain.on('delNode', async (event, node) => {
    db.data.nodes = db.data.nodes.filter(n => n.name !== node.name);
    await db.write();
});

// ========== 消息发送 ==========

/** 发送文字消息（广播给所有节点） */
ipcMain.on('sendT', (event, text) => {
    for (const node of db.data.nodes) {
        let addr = node.addr;
        if (!addr.startsWith('http://')) addr = 'http://' + addr;
        http.sendGet(node.secret, addr, {
            name: db.data.nodeName,
            data: text
        }).then(() => {
            win.webContents.send('trace-show', {
                time: new Date().toLocaleString('zh-CN'),
                target: '成功',
                msg: '[' + node.addr + '] 文字发送成功',
                type: 'log-succ'
            });
        }).catch(err => {
            win.webContents.send('trace-show', {
                time: new Date().toLocaleString('zh-CN'),
                target: '错误',
                msg: '[' + node.addr + '] ' + err.message,
                type: 'log-err'
            });
        });
    }
});

/** 发送文件（广播给所有节点） */
ipcMain.on('sendF', (event, file) => {
    for (const node of db.data.nodes) {
        let addr = node.addr;
        if (!addr.startsWith('http://')) addr = 'http://' + addr;
        const fileName = path.basename(file);
        http.sendPostFile(node.secret, addr, file, {
            name: db.data.nodeName,
            fileName: fileName
        }).then(() => {
            win.webContents.send('trace-show', {
                time: new Date().toLocaleString('zh-CN'),
                target: '成功',
                msg: '[' + node.addr + '] 文件发送成功 [' + fileName + ']',
                type: 'log-succ'
            });
        }).catch(err => {
            win.webContents.send('trace-show', {
                time: new Date().toLocaleString('zh-CN'),
                target: '错误',
                msg: '[' + node.addr + '] ' + err.message,
                type: 'log-err'
            });
        });
    }
});

// ========== 配置保存 ==========

/** 保存文件下载目录 */
ipcMain.on('saveFolderPath', async (event, p) => {
    db.data.saveFolderPath = p;
    await db.write();
});

/** 保存本机节点名称 */
ipcMain.on('saveNodeName', async (event, nodeName) => {
    db.data.nodeName = nodeName;
    await db.write();
});

/** 添加一条追踪日志 */
ipcMain.on('addTrace', async (event, trace) => {
    db.data.traces.unshift(trace);
    await db.write();
});

/** 清空所有追踪日志 */
ipcMain.on('clearTrace', async () => {
    db.data.traces = [];
    await db.write();
});

/** 在文件管理器中定位文件 */
ipcMain.on('showItem', (event, fileName) => {
    const fullPath = path.join(db.data.saveFolderPath, '/', fileName);
    if (fs.existsSync(fullPath)) {
        shell.showItemInFolder(fullPath);
    } else if (db.data.saveFolderPath && fs.existsSync(db.data.saveFolderPath)) {
        shell.openPath(db.data.saveFolderPath);
    }
});

// ========== 数据查询（handle 形式，有返回值） ==========

/** 获取节点列表 */
ipcMain.handle('get-nodes', async () => db.data.nodes);

/**
 * 获取文件保存目录
 * 路径为空或不存在时自动重置为系统下载目录
 */
ipcMain.handle('get-save-folder-path', async () => {
    if (!db.data.saveFolderPath || !fs.existsSync(db.data.saveFolderPath)) {
        try {
            db.data.saveFolderPath = app.getPath('downloads');
        } catch (e) {
            db.data.saveFolderPath = os.homedir();
        }
        await db.write();
    }
    return db.data.saveFolderPath;
});

/**
 * 获取本机节点名称
 * 为空时自动用 MAC 地址生成
 */
ipcMain.handle('get-node-name', async () => {
    if (!db.data.nodeName) {
        db.data.nodeName = getMac();
        await db.write();
    }
    return db.data.nodeName;
});

/** 获取追踪日志列表 */
ipcMain.handle('get-traces', async () => db.data.traces);

/** 弹出文件选择对话框（多选） */
ipcMain.handle('select-files', async () => {
    const {canceled, filePaths} = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections']
    });
    if (!canceled) return filePaths;
});

/** 弹出目录选择对话框 */
ipcMain.handle('select-save-folder', async () => {
    let defaultPath = db.data.saveFolderPath;
    if (!defaultPath || !fs.existsSync(defaultPath)) {
        defaultPath = app.getPath('downloads');
    }
    const {canceled, filePaths} = await dialog.showOpenDialog({
        defaultPath,
        properties: ['openDirectory']
    });
    if (!canceled) return filePaths;
});

/** 获取本机密钥 */
ipcMain.handle('get-my-secret', async () => {
    if (!db.data.secret) {
        db.data.secret = '';
        await db.write();
    }
    return db.data.secret;
});

/** 保存本机密钥（保存后重启 HTTP 服务） */
ipcMain.on('saveMySecret', async (event, secret) => {
    db.data.secret = secret;
    await db.write();
    http.start(win, db, appArgs);
});

/** 获取公网 IPv6 地址 */
ipcMain.handle('get-public-ipv6', async () => ipv6);

// ========== RTC 信令转发 ==========

/** 发起查看屏幕请求（发送 offer） */
ipcMain.on('viewOtherNode', async (event, node, data) => {
    let addr = node.addr;
    if (!addr.startsWith('http://')) addr = 'http://' + addr;
    http.sendPutRtc(node.secret, addr, 'offer', {
        name: db.data.nodeName,
        data: data
    }).then(() => {
        win.webContents.send('trace-show', {
            time: new Date().toLocaleString('zh-CN'),
            target: '系统',
            msg: '[' + node.name + '] 查看屏幕请求成功',
            type: 'log-succ'
        });
    }).catch(err => {
        win.webContents.send('trace-show', {
            time: new Date().toLocaleString('zh-CN'),
            target: '系统',
            msg: '[' + node.name + '] ' + err.message,
            type: 'log-err'
        });
        win.webContents.send('rtc-exit');
    });
});

/** 应答查看屏幕请求（发送 answer） */
ipcMain.on('callbackViewNode', async (event, node, data) => {
    let addr = node.addr;
    if (!addr.startsWith('http://')) addr = 'http://' + addr;
    const primary = screen.getPrimaryDisplay();
    http.sendPutRtc(node.secret, addr, 'answer', {
        name: db.data.nodeName,
        screen: {
            width: primary.size.width,
            height: primary.size.height
        },
        data: data
    }).then(() => {
        win.webContents.send('trace-show', {
            time: new Date().toLocaleString('zh-CN'),
            target: '成功',
            msg: '[' + node.addr + '] 查看屏幕响应成功',
            type: 'log-succ'
        });
    }).catch(err => {
        win.webContents.send('trace-show', {
            time: new Date().toLocaleString('zh-CN'),
            target: '错误',
            msg: '[' + node.addr + '] ' + err.message,
            type: 'log-err'
        });
    });
});

// ========== 窗口控制 ==========

/** 最大化窗口（Mac 上为全屏） */
ipcMain.on('maximize', () => {
    if (process.platform === 'darwin') {
        win.setFullScreen(true);
    } else {
        win.maximize();
    }
});

/** 最小化窗口（同时启动键鼠监听，进入被控模式） */
ipcMain.on('minimize', () => {
    win.minimize();
    nut.start();
    win.webContents.send('trace-show', {
        time: new Date().toLocaleString('zh-CN'),
        target: '系统',
        msg: '开启键鼠控制',
        type: 'log-succ'
    });
});

/** 恢复窗口（同时关闭键鼠监听，退出被控模式） */
ipcMain.on('restore', async () => {
    win.restore();
    await nut.destroy();
    win.webContents.send('trace-show', {
        time: new Date().toLocaleString('zh-CN'),
        target: '系统',
        msg: '关闭键鼠控制',
        type: 'log-succ'
    });
});

/** 取消最大化（Mac 上为退出全屏） */
ipcMain.on('unmaximize', () => {
    if (process.platform === 'darwin') {
        win.setFullScreen(false);
    } else {
        win.unmaximize();
    }
});

// ========== 键鼠控制 ==========

/** 播放键鼠输入事件（被控端执行远程操作） */
ipcMain.on('monitorInput', async (event, payload) => {
    await nut.playInput(JSON.parse(payload));
});

// ========== 工具函数 ==========

/**
 * 获取本机 MAC 地址（用于默认节点名）
 * 优先选择物理网卡，排除虚拟网卡
 */
function getMac() {
    const interfaces = os.networkInterfaces();
    const excludeKeywords = ['vm', 'virtual', 'vbox', 'wsl', 'docker', 'vpn', 'loopback', 'tun', 'tap'];
    const priorityKeywords = ['eth', 'en', '以太网', 'wlan', 'wi-fi', '无线'];
    const candidates = [];

    for (const name of Object.keys(interfaces)) {
        const nameLower = name.toLowerCase();
        if (excludeKeywords.some(k => nameLower.includes(k))) continue;
        for (const iface of interfaces[name]) {
            if (!iface.internal && iface.family === 'IPv4' && iface.mac !== '00:00:00:00:00:00') {
                const priority = priorityKeywords.findIndex(k => nameLower.includes(k));
                candidates.push({
                    mac: iface.mac,
                    name,
                    priority: priority === -1 ? 99 : priority
                });
            }
        }
    }

    candidates.sort((a, b) => a.priority - b.priority);
    return candidates.length > 0 ? candidates[0].mac : '';
}

// ========== 初始化 ==========

/**
 * 启动消息模块
 * @param {object} mainWin - 主窗口
 * @param {object} mainDb - 数据库
 * @param {object} mainAppArgs - 启动参数
 */
function start(mainWin, mainDb, mainAppArgs) {
    win = mainWin;
    db = mainDb;
    appArgs = mainAppArgs;
    ipv6 = ip.getPublicIPv6();
}

module.exports = {start};
