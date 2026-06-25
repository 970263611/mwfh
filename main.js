const {app, BrowserWindow} = require('electron')
const path = require('node:path')
const message = require('./message')
const http = require('./http.js')
const {Low} = require('lowdb')
const {JSONFile} = require('lowdb/node')

let win

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
  win = new BrowserWindow({
    width: 800,
    height: 600,
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
}

app.whenReady().then(() => {
  createWindow()
  message.start(db)
  http.start(win, db, appArgs.port)
})

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