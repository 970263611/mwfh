const path = require('node:path');
const {Low} = require("lowdb");
const {JSONFile} = require("lowdb/node");

function start(appArgs) {
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
    return db
}

module.exports = {
    start
}