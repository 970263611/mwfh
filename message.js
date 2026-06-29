const {dialog, ipcMain, shell} = require('electron')
const path = require('node:path')
const os = require('os')
const http = require('./http')
const ip = require('./ip.js')

let win
let db
let appArgs
let ipv6

ipcMain.on('addNode', async (event, node) => {
    const saveNode = db.data.nodes.find(n => n.name === node.name)
    if (saveNode) {
        saveNode.name = node.name
        saveNode.addr = node.addr
    } else {
        db.data.nodes.push(node)
    }
    await db.write()
})
ipcMain.on('updateNode', async (event, node) => {
    const saveNode = db.data.nodes.find(n => n.name === node.name)
    if (saveNode) {
        saveNode.name = node.name
        saveNode.addr = node.addr
        saveNode.secret = node.secret
    } else {
        db.data.nodes.push(node)
    }
    await db.write()
})
ipcMain.on('delNode', async (event, node) => {
    db.data.nodes = db.data.nodes.filter(n => n.name !== node.name)
    await db.write()
})
ipcMain.on('sendT', (event, text) => {
    for (const node of db.data.nodes) {
        let addr = node.addr
        if (!addr.startsWith("http://")) {
            addr = "http://" + addr
        }
        http.sendGet(node.secret, addr, {
            name: db.data.nodeName,
            data: text
        }).then(() => {
            const trace = {
                "time": new Date().toLocaleString('zh-CN'),
                "target": '成功',
                "msg": '[' + node.addr + '] ' + '文字发送成功',
                "type": "log-succ"
            }
            win.webContents.send('trace-show', trace)
        }).catch(err => {
            const trace = {
                "time": new Date().toLocaleString('zh-CN'),
                "target": '错误',
                "msg": '[' + node.addr + '] ' + err.message,
                "type": "log-err"
            }
            win.webContents.send('trace-show', trace)
        })
    }
})
ipcMain.on('sendF', (event, file) => {
    for (const node of db.data.nodes) {
        let addr = node.addr
        if (!addr.startsWith("http://")) {
            addr = "http://" + addr
        }
        const fileName = path.basename(file)
        http.sendPostFile(node.secret, addr, file, {
            name: db.data.nodeName,
            fileName: fileName
        }, fileName).then(() => {
            const trace = {
                "time": new Date().toLocaleString('zh-CN'),
                "target": '成功',
                "msg": '[' + node.addr + '] ' + '文件发送成功 [' + fileName + ']',
                "type": "log-succ"
            }
            win.webContents.send('trace-show', trace)
        }).catch(err => {
            const trace = {
                "time": new Date().toLocaleString('zh-CN'),
                "target": '错误',
                "msg": '[' + node.addr + '] ' + err.message,
                "type": "log-err"
            }
            win.webContents.send('trace-show', trace)
        })
    }
})
ipcMain.on('saveFolderPath', async (event, path) => {
    db.data.saveFolderPath = path
    await db.write()
})
ipcMain.on('saveNodeName', async (event, nodeName) => {
    db.data.nodeName = nodeName
    await db.write()
})
ipcMain.on('addTrace', async (event, trace) => {
    db.data.traces.unshift(trace)
    await db.write()
})
ipcMain.on('clearTrace', async () => {
    db.data.traces = []
    await db.write()
})
ipcMain.on('showItem', (event, fileName) => {
    shell.showItemInFolder(path.join(db.data.saveFolderPath, "/", fileName))
})

ipcMain.handle('get-nodes', async () => {
    return db.data.nodes
})
ipcMain.handle('get-save-folder-path', async () => {
    if (!db.data.saveFolderPath) {
        const home = os.homedir()
        db.data.saveFolderPath = path.join(home, 'Downloads')
        await db.write()
    }
    return db.data.saveFolderPath
})
ipcMain.handle('get-node-name', async () => {
    if (!db.data.nodeName) {
        db.data.nodeName = getMac()
        await db.write()
    }
    return db.data.nodeName
})
ipcMain.handle('get-traces', async () => {
    return db.data.traces
})
ipcMain.handle('select-files', async () => {
    const {canceled, filePaths} = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections']
    })
    if (!canceled) {
        return filePaths
    }
})

ipcMain.handle('select-save-folder', async () => {
    const {canceled, filePaths} = await dialog.showOpenDialog({
        defaultPath: db.data.saveFolderPath,
        properties: ['openDirectory']
    })
    if (!canceled) {
        return filePaths
    }
})

ipcMain.handle('get-my-secret', async () => {
    if (!db.data.secret) {
        db.data.secret = ''
        await db.write()
    }
    return db.data.secret
})

ipcMain.on('saveMySecret', async (event, secret) => {
    db.data.secret = secret
    await db.write()
    http.start(win, db, appArgs)
})

ipcMain.handle('get-public-ipv6', async () => {
    return ipv6
})

ipcMain.on('viewOtherNode', async (event, node, data) => {
    let addr = node.addr
    if (!addr.startsWith("http://")) {
        addr = "http://" + addr
    }
    http.sendPutRtc(node.secret, addr, 'offer', {
        name: db.data.nodeName,
        data: data
    }).then(() => {
        const trace = {
            "time": new Date().toLocaleString('zh-CN'),
            "target": addr,
            "msg": '[' + node.addr + '] ' + '查看屏幕请求成功',
            "type": "log-succ"
        }
        win.webContents.send('trace-show', trace)
    }).catch(err => {
        const trace = {
            "time": new Date().toLocaleString('zh-CN'),
            "target": '错误',
            "msg": '[' + node.addr + '] ' + err.message,
            "type": "log-err"
        }
        win.webContents.send('trace-show', trace)
    })
})

ipcMain.on('callbackViewNode', async (event, node, data) => {
    let addr = node.addr
    if (!addr.startsWith("http://")) {
        addr = "http://" + addr
    }
    http.sendPutRtc(node.secret, addr, 'answer', {
        name: db.data.nodeName,
        data: data
    }).then(() => {
        const trace = {
            "time": new Date().toLocaleString('zh-CN'),
            "target": '成功',
            "msg": '[' + node.addr + '] ' + '查看屏幕响应成功',
            "type": "log-succ"
        }
        win.webContents.send('trace-show', trace)
    }).catch(err => {
        const trace = {
            "time": new Date().toLocaleString('zh-CN'),
            "target": '错误',
            "msg": '[' + node.addr + '] ' + err.message,
            "type": "log-err"
        }
        win.webContents.send('trace-show', trace)
    })
})

ipcMain.on('minimize', () => {
    win.minimize()
})

function getMac() {
    const interfaces = os.networkInterfaces();
    // 虚拟网卡关键词，用于排除
    const excludeKeywords = ['vm', 'virtual', 'vbox', 'wsl', 'docker', 'vpn', 'loopback', 'tun', 'tap'];
    // 物理网卡优先级关键词
    const priorityKeywords = ['eth', 'en', '以太网', 'wlan', 'wi-fi', '无线'];

    const candidates = [];

    for (const name of Object.keys(interfaces)) {
        const nameLower = name.toLowerCase();
        // 跳过虚拟网卡
        if (excludeKeywords.some(key => nameLower.includes(key))) continue;

        for (const iface of interfaces[name]) {
            if (!iface.internal && iface.family === 'IPv4' && iface.mac !== '00:00:00:00:00:00') {
                // 计算优先级，数值越小优先级越高
                const priority = priorityKeywords.findIndex(key => nameLower.includes(key));
                candidates.push({mac: iface.mac, name, priority: priority === -1 ? 99 : priority});
            }
        }
    }

    // 按优先级排序
    candidates.sort((a, b) => a.priority - b.priority);
    return candidates.length > 0 ? candidates[0].mac : '';
}

function start(mainWin, mainDb, mainAppArgs) {
    win = mainWin
    db = mainDb
    appArgs = mainAppArgs
    ipv6 = ip.getPublicIPv6()
}

module.exports = {
    start
}