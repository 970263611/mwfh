const path = require('node:path')
const {Low} = require('lowdb')
const {JSONFile} = require('lowdb/node')
const os = require("os");

/**
 * 初始化本地数据库（lowdb）
 * @param {object} appArgs - 启动参数，可通过 dbDir 指定数据库目录
 * @returns {Low} lowdb 实例
 */
function start(appArgs) {
    // 数据库文件路径，默认在程序目录下
    let dbDir = path.join(getAppDataDir('mwfh'), 'db.json')
    if (appArgs.dbDir) {
        dbDir = path.join(appArgs.dbDir, 'db.json')
    }

    // 默认数据结构
    const defaultData = {
        nodeName: '',         // 本机节点名称
        traces: [],           // 日志追踪记录
        nodes: [],            // 节点列表
        saveFolderPath: '',   // 文件保存目录
        secret: ''            // 本机通讯密钥
    }

    // 创建数据库实例并读取已有数据
    const db = new Low(new JSONFile(dbDir), defaultData)
    ;(async () => {
        await db.read()
    })()
    return db
}

function getAppDataDir(appName) {
    const platform = process.platform
    let basePath

    switch (platform) {
        case 'win32':
            // Windows 习惯：存放在 AppData\Local 或 AppData\Roaming
            basePath = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
            break
        case 'darwin':
            // macOS 习惯：存放在 ~/Library/Application Support/
            basePath = path.join(os.homedir(), 'Library', 'Application Support')
            break
        case 'linux':
            // Linux 习惯：遵循 XDG Base Directory 规范，存放在 ~/.local/share/
            basePath = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
            break
        default:
            // 其他系统兜底：存放在用户主目录
            basePath = os.homedir()
    }

    // 将应用名称拼接到基础路径后
    return path.join(basePath, appName)
}

module.exports = {
    start
}
