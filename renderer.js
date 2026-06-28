function addNode(name, addr, secret) {
    window.ea.addNode({
        name: name,
        addr: addr,
        secret: secret
    })
}

function updateNode(name, addr, secret) {
    window.ea.updateNode({
        name: name,
        addr: addr,
        secret: secret
    })
}

function delNode(name) {
    window.ea.delNode({
        name: name
    })
}

function sendT(text) {
    window.ea.sendT(text)
}

function sendF(file) {
    window.ea.sendF(file)
}

async function upload_files() {
    return window.ea.selectFiles()
}

async function select_folder() {
    return window.ea.selectSaveFolder()
}

function saveFolderPathToMain(path) {
    window.ea.saveFolderPath(path)
}

async function getNodes() {
    return window.ea.getNodes()
}

async function getSaveFolderPath() {
    return window.ea.getSaveFolderPath()
}

function addTrace(trace) {
    window.ea.addTrace(trace)
}

async function getTraces() {
    return window.ea.getTraces()
}

function clearTrace() {
    window.ea.clearTrace()
}

window.ea.onTraceShow((trace) => {
    addTrace(trace)
    renderLog()
})

function getCurrentNodeName(nodeName) {
    return window.ea.getNodeName(nodeName)
}

function saveCurrentNodeNameToMain(nodeName) {
    window.ea.saveNodeName(nodeName)
}

async function getMySecret() {
    return window.ea.getMySecret()
}

async function saveMySecretToMain(secret) {
    window.ea.saveMySecret(secret)
}

async function getPublicIPv6() {
    return window.ea.getPublicIPv6()
}

async function viewOtherNodeFromMain(node) {
    navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true
    }).then(async stream => {
        const video = document.querySelector('video')
        video.srcObject = stream
        video.onloadedmetadata = (e) => video.play()
        await startRtc(stream, node)
    }).catch(err => {
        pushLog('错误', '[' + node.addr + '] ' + err.message, 'log-err')
    })
}

window.ea.rtcRecv(async (payload) => {
    await handleRemoteOffer(payload.name, payload.addr, payload.secret, payload.data)
})

window.ea.rtcCallback(async (payload) => {
    await handleRemoteAnswer(payload.data)
})