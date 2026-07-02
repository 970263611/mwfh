const { contextBridge, ipcRenderer, webUtils } = require('electron/renderer');

/**
 * IPC 回调缓存
 * 使用对象存储回调函数，避免重复注册监听器导致内存泄漏和重复触发
 * 所有监听器在 preload 加载时一次性注册，之后只替换回调函数
 */
const ipcHandlers = {
    traceShow: null,     // 日志追踪显示回调
    rtcRecv: null,       // RTC offer 接收回调
    rtcCallback: null,   // RTC answer 接收回调
    rtcExit: null,       // RTC 退出回调
    disconnectControlled: null  // 被控端主动断开回调
};

// ========== 全局 IPC 监听（一次性注册） ==========

ipcRenderer.on('trace-show', (_, trace) => {
    if (ipcHandlers.traceShow) ipcHandlers.traceShow(trace);
});

ipcRenderer.on('rtc-recv', (_, payload) => {
    if (ipcHandlers.rtcRecv) ipcHandlers.rtcRecv(payload);
});

ipcRenderer.on('rtc-callback', (_, payload) => {
    if (ipcHandlers.rtcCallback) ipcHandlers.rtcCallback(payload);
});

ipcRenderer.on('rtc-exit', () => {
    if (ipcHandlers.rtcExit) ipcHandlers.rtcExit();
});

ipcRenderer.on('disconnect-controlled', () => {
    if (ipcHandlers.disconnectControlled) ipcHandlers.disconnectControlled();
});

// ========== 暴露给渲染进程的 API ==========

contextBridge.exposeInMainWorld('ea', {
    // ----- 单向发送（fire-and-forget） -----

    // 节点管理
    addNode: (node) => ipcRenderer.send('addNode', node),
    updateNode: (node) => ipcRenderer.send('updateNode', node),
    delNode: (node) => ipcRenderer.send('delNode', node),

    // 消息发送
    sendT: (text) => ipcRenderer.send('sendT', text),
    sendF: (file) => ipcRenderer.send('sendF', file),

    // 配置保存
    saveFolderPath: (path) => ipcRenderer.send('saveFolderPath', path),
    saveNodeName: (nodeName) => ipcRenderer.send('saveNodeName', nodeName),
    addTrace: (trace) => ipcRenderer.send('addTrace', trace),
    clearTrace: () => ipcRenderer.send('clearTrace'),
    showItem: (fileName) => ipcRenderer.send('showItem', fileName),

    // RTC 相关
    viewOtherNode: (node, data) => ipcRenderer.send('viewOtherNode', node, data),
    callbackViewNode: (node, data) => ipcRenderer.send('callbackViewNode', node, data),

    // 窗口控制
    maximize: () => ipcRenderer.send('maximize'),
    minimize: () => ipcRenderer.send('minimize'),
    unmaximize: () => ipcRenderer.send('unmaximize'),
    restore: () => ipcRenderer.send('restore'),

    // 键鼠控制
    monitorInput: (payload) => ipcRenderer.send('monitorInput', payload),

    // 密钥相关
    saveMySecret: (secretKey) => ipcRenderer.send('saveMySecret', secretKey),

    // ----- 异步请求（有返回值） -----

    getNodes: () => ipcRenderer.invoke('get-nodes'),
    getSaveFolderPath: () => ipcRenderer.invoke('get-save-folder-path'),
    getNodeName: () => ipcRenderer.invoke('get-node-name'),
    getTraces: () => ipcRenderer.invoke('get-traces'),
    selectFiles: () => ipcRenderer.invoke('select-files'),
    selectSaveFolder: () => ipcRenderer.invoke('select-save-folder'),
    getMySecret: () => ipcRenderer.invoke('get-my-secret'),
    getPublicIPv6: () => ipcRenderer.invoke('get-public-ipv6'),

    // ----- 主进程推送监听（替换回调方式） -----

    /** 设置日志追踪回调 */
    onTraceShow: (callback) => {
        ipcHandlers.traceShow = callback;
    },
    /** 设置 RTC offer 接收回调 */
    rtcRecv: (callback) => {
        ipcHandlers.rtcRecv = callback;
    },
    /** 设置 RTC answer 接收回调 */
    rtcCallback: (callback) => {
        ipcHandlers.rtcCallback = callback;
    },
    /** 设置 RTC 退出回调 */
    rtcExit: (callback) => {
        ipcHandlers.rtcExit = callback;
    },

    /** 设置被控端主动断开回调 */
    onDisconnectControlled: (callback) => {
        ipcHandlers.disconnectControlled = callback;
    },

    /** 清空所有回调（页面卸载时调用） */
    clearAllIpcCallbacks: () => {
        ipcHandlers.traceShow = null;
        ipcHandlers.rtcRecv = null;
        ipcHandlers.rtcCallback = null;
        ipcHandlers.rtcExit = null;
        ipcHandlers.disconnectControlled = null;
    },

    // ----- 拖拽上传 -----

    /**
     * 绑定文件拖拽上传区域
     * @param {string} elementId - 拖拽区域 DOM 元素 ID
     */
    bindDropArea: (elementId) => {
        const el = document.getElementById(elementId);
        if (!el) return;

        // 拖拽经过：高亮样式
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

        // 拖拽放下：获取文件路径并触发自定义事件
        el.addEventListener('drop', (e) => {
            e.preventDefault();
            el.style.borderColor = 'var(--border)';
            el.style.background = 'transparent';

            const files = Array.from(e.dataTransfer.files);
            const paths = files.map(file => webUtils.getPathForFile(file));
            el.dispatchEvent(new CustomEvent('file-drop', {detail: paths}));
        });
    }
});
