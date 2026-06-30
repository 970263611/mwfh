const {contextBridge, ipcRenderer, webUtils} = require('electron/renderer')

contextBridge.exposeInMainWorld('ea', {
    addNode: (node) => ipcRenderer.send('addNode', node),
    updateNode: (node) => ipcRenderer.send('updateNode', node),
    delNode: (node) => ipcRenderer.send('delNode', node),
    sendT: (text) => ipcRenderer.send('sendT', text),
    sendF: (file) => ipcRenderer.send('sendF', file),
    saveFolderPath: (path) => ipcRenderer.send('saveFolderPath', path),
    saveNodeName: (nodeName) => ipcRenderer.send('saveNodeName', nodeName),
    addTrace: (trace) => ipcRenderer.send('addTrace', trace),
    clearTrace: () => ipcRenderer.send('clearTrace'),

    getNodes: () => ipcRenderer.invoke('get-nodes'),
    getSaveFolderPath: () => ipcRenderer.invoke('get-save-folder-path'),
    getNodeName: () => ipcRenderer.invoke('get-node-name'),
    getTraces: () => ipcRenderer.invoke('get-traces'),
    selectFiles: () => ipcRenderer.invoke('select-files'),
    selectSaveFolder: () => ipcRenderer.invoke('select-save-folder'),

    showItem: (fileName) => ipcRenderer.send('showItem', fileName),

    onTraceShow: (callback) => ipcRenderer.on('trace-show', (event, trace) => callback(trace)),

    rtcRecv: (callback) => ipcRenderer.on('rtc-recv', (event, payload) => callback(payload)),

    rtcCallback: (callback) => ipcRenderer.on('rtc-callback', (event, payload) => callback(payload)),

    getMySecret: () => ipcRenderer.invoke('get-my-secret'),

    saveMySecret: (secretKey) => ipcRenderer.send('saveMySecret', secretKey),

    getPublicIPv6: () => ipcRenderer.invoke('get-public-ipv6'),

    viewOtherNode: (node, data) => ipcRenderer.send('viewOtherNode', node, data),

    callbackViewNode: (node, data) => ipcRenderer.send('callbackViewNode', node, data),

    maximize: () => ipcRenderer.send('maximize'),

    minimize: () => ipcRenderer.send('minimize'),

    unmaximize: () => ipcRenderer.send('unmaximize'),

    restore: () => ipcRenderer.send('restore'),

    rtcExit: (callback) => ipcRenderer.on('rtc-exit', () => callback()),

    monitorInput: (payload) => ipcRenderer.send('monitorInput', payload),

    // 绑定拖拽区域，拖拽完成后返回绝对路径数组
    bindDropArea: (elementId) => {
        const el = document.getElementById(elementId);
        if (!el) return;

        // 拖拽经过：阻止默认行为 + 高亮样式
        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            el.style.borderColor = '#165DFF';
            el.style.background = 'rgba(22,93,255,0.02)';
        });

        // 拖拽离开：恢复样式
        el.addEventListener('dragleave', () => {
            el.style.borderColor = 'var(--border)';
            el.style.background = 'transparent';
        });

        // 拖拽释放：提取路径 + 派发事件
        el.addEventListener('drop', (e) => {
            e.preventDefault();
            el.style.borderColor = 'var(--border)';
            el.style.background = 'transparent';

            // 隔离上下文中可正常读取
            const files = Array.from(e.dataTransfer.files);
            const paths = files.map(file => webUtils.getPathForFile(file));

            // 派发自定义事件，把路径传给页面
            el.dispatchEvent(new CustomEvent('file-drop', {detail: paths}));
        });
    }
})