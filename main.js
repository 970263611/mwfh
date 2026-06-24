const {app, BrowserWindow, ipcMain, dialog} = require('electron')
const path = require('node:path')
const os = require('os')
const {Low} = require('lowdb')
const {JSONFile} = require('lowdb/node')
const http = require('http')

const defaultData = {
  traces: [],
  nodes: [],
  saveFolderPath: '',
}

const db = new Low(new JSONFile(path.join(__dirname, 'db.json')), defaultData)
;(async () => {
  await db.read()
})()

let win

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
    console.log(text)
  })
  ipcMain.on('sendF', (event, file) => {
    console.log(file)
  })
  ipcMain.on('saveFolderPath', async (event, path) => {
    db.data.saveFolderPath = path
    await db.write()
  })
  ipcMain.on('addTrace', async (event, trace) => {
    db.data.traces.unshift(trace)
    await db.write()
  })
  ipcMain.on('clearTrace', async (event) => {
    db.data.traces = []
    await db.write()
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
      properties: ['openDirectory']
    })
    if (!canceled) {
      return filePaths
    }
  })

  win.webContents.once('did-finish-load', () => {
    if (!app.isPackaged) {
      win.webContents.openDevTools({mode: 'detach'});
    }
  });
}

app.whenReady().then(() => {
  createWindow()
})

// 创建服务
const server = http.createServer((req, res) => {
  // req：请求对象，res：响应对象
  // 设置响应头：返回json，编码utf8
  res.setHeader('Content-Type', 'application/json;charset=utf-8')
  // 判断路由
  if (req.url === '/' && req.method === 'POST') {
    let body = ''
    // 分段接收数据
    req.on('data', chunk => {
      body += chunk.toString()
    })
    // 接收完毕
    req.on('end', () => {
      const params = JSON.parse(body)
      const trace = {
        "time": new Date().toLocaleString(),
        "target": "系统",
        "msg": "接收到新文字信息\r\n" + params.data + "\r\n",
        "type": "log-succ"
      }
      win.webContents.send('trace-show', trace)
    })
    res.end(JSON.stringify({code: 200}))
  } else {
    res.writeHead(404)
    res.end(JSON.stringify({code: 404}))
  }
})

// 监听端口 3000
const port = 5216
server.listen(port, () => {
  console.log(`服务启动成功：http://localhost:${port}`)
})