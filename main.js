// 引入 Electron 相关模块
const {app, BrowserWindow, Tray, Menu, nativeImage, desktopCapturer, session} = require('electron')
// 引入 Node.js 内置模块
const path = require('node:path')  // 路径处理
// 引入项目内部模块
const message = require('./message')    // 消息处理模块
const http = require('./http.js')       // HTTP 服务模块
const dbManager = require('./db.js')    // 数据库管理模块
// const watchdog = require('./watchdog.js')  // 看门狗与光标控制模块

// ========== 全局变量 ==========
let win          // 主窗口对象
let isQuitting   // 是否正在退出程序（用于区分关闭窗口和真正退出）
let tray         // 系统托盘对象

// 解析命令行启动参数
const appArgs = parseAppArgs()

// 初始化数据库
const db = dbManager.start(appArgs)

// ========== 创建主窗口 ==========
const createWindow = () => {
    // 隐藏应用菜单栏
    Menu.setApplicationMenu(null)
    
    // 创建浏览器窗口
    win = new BrowserWindow({
        width: 800,                    // 窗口宽度
        height: 600,                   // 窗口高度
        autoHideMenuBar: true,         // 自动隐藏菜单栏
        icon: getIcon(),               // 窗口图标
        webPreferences: {
            devTools: true,            // 启用开发者工具
            contextIsolation: true,    // 启用上下文隔离（安全）
            nodeIntegration: false,    // 禁用 Node.js 集成（安全）
            desktopCapturer: true,     // 启用桌面捕获
            preload: path.join(__dirname, 'preload.js')  // 预加载脚本
        }
    })
    
    // 加载主页面
    win.loadFile('index.html')
    
    // 页面加载完成后
    win.webContents.once('did-finish-load', () => {
        // 开发环境下自动打开开发者工具（分离模式）
        if (!app.isPackaged) {
            win.webContents.openDevTools({mode: 'detach'});
        }
    });
    
    // ========== 关键：关闭窗口拦截 ==========
    // 点击关闭按钮时不退出程序，而是隐藏到托盘后台运行
    win.on('close', (e) => {
        // 如果是真正退出程序，则不拦截
        if (isQuitting) return
        // 阻止窗口关闭的默认行为
        e.preventDefault()
        // 隐藏窗口，后台运行
        win.hide()
    })
    
    // 窗口获得焦点
    win.focus()
}

// ========== Electron 应用就绪事件 ==========
app.whenReady().then(async () => {
    createWindow()   // 创建主窗口
    createTray()     // 创建系统托盘
    
    // 启动消息模块
    message.start(win, db, appArgs)
    // 启动 HTTP 服务
    http.start(win, db, appArgs)
    
    // macOS 上设置 Dock 图标（使用大尺寸）
    if (process.platform === 'darwin') {
        const dockIconPath = getIcon('large')
        app.dock.setIcon(dockIconPath)
    }

    // ========== 设置屏幕共享请求处理器 ==========
    // 拦截 getDisplayMedia 请求，自动选择第一个屏幕源，不显示系统选择器
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        // 不用 async 包裹回调，避免异步时序导致的先抛后 catch 警告
        desktopCapturer.getSources({types: ['screen']})
            .then(sources => {
                // 没有可用的屏幕源
                if (!Array.isArray(sources) || sources.length === 0) {
                    // 记录错误日志
                    win.webContents.send('trace-show', {
                        "time": new Date().toLocaleString('zh-CN'),
                        "target": '系统',
                        "msg": `无可用屏幕源，拒绝录屏`,
                        "type": "log-err"
                    })
                    return callback(null)  // 返回 null 表示拒绝
                }
                // 只传 video，完全移除 audio 字段，杜绝 loopback 兼容故障
                callback({video: sources[0]})
            })
            .catch(err => {
                // 获取屏幕源失败
                win.webContents.send('trace-show', {
                    "time": new Date().toLocaleString('zh-CN'),
                    "target": '系统',
                    "msg": 'desktopCapturer 获取屏幕失败：' + err.message,
                    "type": "log-err"
                })
                // 异常必须回调 null 终止媒体请求，防止渲染进程卡死
                callback(null)
            })
    }, {useSystemPicker: false})  // 不使用系统选择器
})

// ========== macOS 兼容 ==========
// 应用即将退出事件
app.on('before-quit', () => {
    isQuitting = true  // 标记为真正退出，让窗口关闭事件不拦截
    // 兜底：确保程序退出前恢复系统光标
    // try {
    //     watchdog.stopWatchdog();
    //     watchdog.showCursor();
    // } catch (e) {
    //     // 忽略退出时的错误
    // }
})

// 所有窗口都关闭时
app.on('window-all-closed', () => {
    // Windows/Linux 全部窗口关闭直接退出
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

// 应用激活事件（点击 Dock 图标等）
app.on('activate', () => {
    // 如果没有窗口，则创建新窗口
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    } else {
        // 有窗口则显示并聚焦
        win.show()
        win.focus()
    }
})

// ========== 创建系统托盘 ==========
function createTray() {
    // 创建托盘图标（小尺寸）
    tray = new Tray(getIcon('small'))
    
    // 创建托盘右键菜单
    const contextMenu = Menu.buildFromTemplate([
        {
            label: '显示窗口',       // 菜单项文字
            click: () => {
                win.show()         // 点击显示主窗口
            }
        },
        {
            label: '退出程序',       // 菜单项文字
            click: () => {
                win.destroy()      // 销毁窗口
                app.quit()         // 退出程序
            }
        }
    ])

    // 托盘左键点击事件：切换窗口显示/隐藏
    tray.on('click', () => {
        if (win.isVisible()) win.hide()  // 窗口可见则隐藏
        else {
            win.show()   // 窗口隐藏则显示
            win.focus()  // 获得焦点
        }
    })

    // 托盘右键点击事件：弹出菜单
    tray.on('right-click', () => {
        tray.popUpContextMenu(contextMenu)
    })
}

/**
 * 解析启动命令行参数
 * 兼容 --key=value 和 --key value 两种格式
 * @returns {Record<string, string | boolean>} 参数对象
 */
function parseAppArgs() {
    const args = {};           // 存放解析结果
    const argv = process.argv; // 命令行参数数组

    // 遍历所有参数
    for (let i = 0; i < argv.length; i++) {
        const item = argv[i];
        // 不是以 -- 开头的跳过
        if (!item.startsWith('--')) continue;

        // 处理 --key=value 等号格式
        if (item.includes('=')) {
            const [key, value] = item.slice(2).split('=');  // 去掉 --，按 = 分割
            args[key] = value;
            continue;
        }

        // 处理 --key value 空格格式
        const key = item.slice(2);           // 去掉 --，得到 key
        const nextItem = argv[i + 1];        // 下一个参数
        if (nextItem && !nextItem.startsWith('--')) {
            // 下一个参数不是新的选项，则作为值
            args[key] = nextItem;
            i++;  // 跳过下一个参数
        } else {
            // 没有值的开关参数，标记为 true
            args[key] = true;
        }
    }

    return args;
}

/**
 * 获取应用图标
 * 按系统不同、用途不同自动选择合适的图标尺寸和格式
 * @param {string} type - 图标类型：'small' 托盘小图标 / 'normal' 窗口图标 / 'large' 大图标(Dock等)
 * @returns {nativeImage} 原生图片对象
 */
function getIcon(type = 'normal') {
    const iconsDir = path.join(__dirname, 'icons')
    const platform = process.platform

    // 根据用途选择尺寸
    let size
    switch (type) {
        case 'small':   // 托盘图标 - 小尺寸
            size = 32
            break
        case 'large':   // Dock / 大尺寸场景
            size = 512
            break
        case 'normal':  // 窗口图标 - 默认
        default:
            size = 256
            break
    }

    // Windows 优先使用 ico 格式，其他系统用 png
    let iconPath
    if (platform === 'win32') {
        iconPath = path.join(iconsDir, `icon-${size}.ico`)
    } else {
        iconPath = path.join(iconsDir, `icon-${size}.png`)
    }

    // 如果对应尺寸不存在，回退到 256 尺寸
    const fs = require('fs')
    if (!fs.existsSync(iconPath)) {
        const fallbackSize = 256
        const fallbackExt = platform === 'win32' ? 'ico' : 'png'
        iconPath = path.join(iconsDir, `icon-${fallbackSize}.${fallbackExt}`)
    }

    return nativeImage.createFromPath(iconPath)
}
