const path = require('node:path');
const {Low} = require('lowdb');
const {JSONFile} = require('lowdb/node');

/**
 * 初始化本地数据库（lowdb）
 * @param {object} appArgs - 启动参数，可通过 dbDir 指定数据库目录
 * @returns {Low} lowdb 实例
 */
function start(appArgs) {
    // 数据库文件路径，默认在程序目录下
    let dbDir = path.join(__dirname, 'db.json');
    if (appArgs.dbDir) {
        dbDir = path.join(appArgs.dbDir, 'db.json');
    }

    // 默认数据结构
    const defaultData = {
        nodeName: '',         // 本机节点名称
        traces: [],           // 日志追踪记录
        nodes: [],            // 节点列表
        saveFolderPath: '',   // 文件保存目录
        secret: ''            // 本机通讯密钥
    };

    // 创建数据库实例并读取已有数据
    const db = new Low(new JSONFile(dbDir), defaultData);
    (async () => {
        await db.read();
    })();
    return db;
}

module.exports = {
    start
};
