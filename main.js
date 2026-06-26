const {app, BrowserWindow, Tray, Menu, nativeImage} = require('electron')
const path = require('node:path')
const message = require('./message')
const http = require('./http.js')
const dbManager = require('./db.js')

let win
let isQuitting //兼容mac退出

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
}

app.whenReady().then(() => {
  // if (process.platform === 'darwin') {
  //   const dockIcon = path.join(__dirname, './logo.icns')
  //   app.dock.setIcon(dockIcon)
  // }
  createWindow()
  createTray()
  message.start(win, db)
  http.start(win, db, appArgs.port)
  if (process.platform === 'darwin') {
    const dockIconPath = path.join(__dirname, './logo.png')
    app.dock.setIcon(dockIconPath)
  }
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
  const tray = new Tray(getIcon())
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

function getIcon() {
  return nativeImage.createFromPath(path.join(__dirname, 'logo.png'))
}