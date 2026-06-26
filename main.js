const {app, BrowserWindow, Tray, Menu} = require('electron')
const path = require('node:path')
const message = require('./message')
const http = require('./http.js')
const {Low} = require('lowdb')
const {JSONFile} = require('lowdb/node')

let win

if(require('electron-squirrel-startup')) app.quit()

const appArgs = parseAppArgs()

let dbDir = path.join(__dirname, 'db.json')
if (appArgs.dbDir) {
  dbDir = path.join(appArgs.dbDir, 'db.json')
}

const defaultData = {
  nodeName: '',
  traces: [],
  nodes: [],
  saveFolderPath: '',
}

const db = new Low(new JSONFile(dbDir), defaultData)
;(async () => {
  await db.read()
})()

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
})

// Mac 适配：dock点击重新显示窗口
app.on('activate', () => {
  if (win === null) createWindow()
  else win.show()
})

app.on('window-all-closed', (e) => {
  e.preventDefault()
})

function createTray() {
  tray = new Tray(path.join(__dirname, getIcon()))
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
  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    win.isVisible() ? win.hide() : win.show()
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
  const platform = process.platform
  let logo
  if (platform === 'win32') {
    logo = 'logo.ico'
  } else if (platform === 'darwin') {
    logo = 'logo.png'
  } else if (platform === 'linux') {
    logo = 'logo.png'
  }
  return logo
}