const {app, BrowserWindow, Tray, Menu, nativeImage, desktopCapturer, session} = require('electron')
const path = require('node:path')
const message = require('./message')
const http = require('./http.js')
const dbManager = require('./db.js')

let win
let isQuitting
let tray

const appArgs = parseAppArgs()

const db = dbManager.start(appArgs)

const createWindow = () => {
    Menu.setApplicationMenu(null)
    win = new BrowserWindow({
        width: 800,
        height: 600,
        autoHideMenuBar: true,
        icon: getIcon(),
        webPreferences: {
            devTools: true,
            contextIsolation: true,
            nodeIntegration: false,
            desktopCapturer: true,
            preload: path.join(__dirname, 'preload.js')
        }
    })
    win.loadFile('index.html')
    win.webContents.once('did-finish-load', () => {
        if (!app.isPackaged) {
            win.webContents.openDevTools({mode: 'detach'});
        }
    });
    // ========== 关键：关闭窗口拦截 ==========
    win.on('close', (e) => {
        if (isQuitting) return
        // 阻止程序真正退出
        e.preventDefault()
        // 隐藏窗口，后台运行
        win.hide()
    })
    win.focus()
}

app.whenReady().then(async () => {
    createWindow()
    createTray()
    message.start(win, db, appArgs)
    http.start(win, db, appArgs)
    if (process.platform === 'darwin') {
        const dockIconPath = getIcon()
        app.dock.setIcon(dockIconPath)
    }

    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        // 不用 async 包裹回调，避免异步时序导致的先抛后 catch 警告
        desktopCapturer.getSources({types: ['screen']})
            .then(sources => {
                if (!Array.isArray(sources) || sources.length === 0) {
                    const trace = {
                        "time": new Date().toLocaleString('zh-CN'),
                        "target": '系统',
                        "msg": `无可用屏幕源，拒绝录屏`,
                        "type": "log-err"
                    }
                    win.webContents.send('trace-show', trace)
                    return callback(null)
                }
                // 只传 video，完全移除 audio 字段，杜绝loopback兼容故障
                callback({video: sources[0]})
            })
            .catch(err => {
                const trace = {
                    "time": new Date().toLocaleString('zh-CN'),
                    "target": '系统',
                    "msg": 'desktopCapturer 获取屏幕失败：' + err.message,
                    "type": "log-err"
                }
                win.webContents.send('trace-show', trace)
                // 异常必须回调 null 终止媒体请求，防止渲染进程卡死
                callback(null)
            })
    }, {useSystemPicker: false})
})

//mac兼容
app.on('before-quit', () => {
    isQuitting = true
})
app.on('window-all-closed', () => {
    // Windows/Linux 全部窗口关闭直接退出
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    } else {
        win.show()
        win.focus()
    }
})

function createTray() {
    tray = new Tray(getIcon('small'))
    const contextMenu = Menu.buildFromTemplate([
        {
            label: '显示窗口',
            click: () => {
                win.show()
            }
        },
        {
            label: '退出程序',
            click: () => {
                win.destroy()
                app.quit()
            }
        }
    ])

    tray.on('click', () => {
        if (win.isVisible()) win.hide()
        else {
            win.show()
            win.focus()
        }
    })

    tray.on('right-click', () => {
        tray.popUpContextMenu(contextMenu)
    })
}

/**
 * 解析启动命令行参数，兼容 --key=value 和 --key value 两种格式
 * @returns {Record<string, string | boolean>}
 */
function parseAppArgs() {
    const args = {};
    const argv = process.argv;

    for (let i = 0; i < argv.length; i++) {
        const item = argv[i];
        if (!item.startsWith('--')) continue;

        // 处理 --key=value 等号格式
        if (item.includes('=')) {
            const [key, value] = item.slice(2).split('=');
            args[key] = value;
            continue;
        }

        // 处理 --key value 空格格式
        const key = item.slice(2);
        const nextItem = argv[i + 1];
        if (nextItem && !nextItem.startsWith('--')) {
            args[key] = nextItem;
            i++;
        } else {
            args[key] = true; // 无值开关标记为 true
        }
    }

    return args;
}

function getIcon(type) {
    if(type === 'small'){
        return nativeImage.createFromPath(path.join(__dirname, 'icon.png'))
    }
    return nativeImage.createFromPath(path.join(__dirname, 'icon.png'))
}