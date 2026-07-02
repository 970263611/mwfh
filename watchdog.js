/**
 * 看门狗与跨平台光标控制模块
 *
 * 本模块承担两个职责：
 * 1. 主进程模式：提供看门狗启停、光标隐藏/显示的 API
 * 2. 子进程模式：作为独立守护进程，监控主进程状态，主进程异常退出时恢复光标
 *
 * 通过启动参数区分两种模式：
 * - 主进程模式：直接 require 本模块，调用 start() / stop() 等函数
 * - 子进程模式：electron watchdog.js <parentPid>，进入看门狗守护逻辑
 */

const { app } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');
const koffi = require('koffi');

// ==================== 全局变量 ====================

/** 主窗口对象（仅主进程模式使用） */
let win = null;

/** 看门狗子进程引用（仅主进程模式使用） */
let watchdogProcess = null;

/** 当前平台 */
const platform = os.platform();

/** Koffi 库句柄（用于操作系统光标） */
let cursorLib = null;

/** Linux XFixes 扩展库句柄 */
let xfixesLib = null;

/** Linux X11 Display 句柄 */
let displayHandle = null;

/** Linux 根窗口ID */
let rootWindow = 0;

/** 光标是否处于隐藏状态 */
let isCursorHidden = false;

// ==================== 日志工具函数 ====================

/**
 * 发送日志到渲染进程
 * @param {string} target - 日志目标/分类
 * @param {string} msg - 日志内容
 * @param {string} type - 日志类型：log-succ / log-err / log-warn
 */
function sendLog(target, msg, type = 'log-warn') {
    if (win && win.webContents && !win.isDestroyed()) {
        win.webContents.send('trace-show', {
            time: new Date().toLocaleString('zh-CN'),
            target,
            msg,
            type
        });
    }
}

// ==================== 跨平台光标控制 ====================

/**
 * 初始化光标控制模块
 * 加载系统底层库，准备好光标隐藏/显示能力
 * @param {object} mainWin - 主窗口对象，用于发送日志
 */
function initCursor(mainWin) {
    win = mainWin;

    // 重复初始化直接返回
    if (cursorLib) return;

    try {
        if (platform === 'win32') {
            // Windows：user32 ShowCursor
            cursorLib = koffi.load('user32.dll');
        } else if (platform === 'darwin') {
            // macOS CoreGraphics
            cursorLib = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
        } else if (platform === 'linux') {
            // Linux X11 + Xfixes
            cursorLib = koffi.load('libX11.so.6');
            xfixesLib = koffi.load('libXfixes.so.3');

            // XOpenDisplay(null)
            const XOpenDisplay = cursorLib.func('XOpenDisplay', 'pointer', ['string']);
            displayHandle = XOpenDisplay(null);

            if (koffi.isNull(displayHandle)) {
                sendLog('系统', '无法打开 X11 Display，可能处于 Wayland 环境，光标控制不可用', 'log-warn');
                cursorLib = null;
                xfixesLib = null;
                return;
            }

            // 获取根窗口
            const XDefaultRootWindow = cursorLib.func('XDefaultRootWindow', 'uint64', ['pointer']);
            rootWindow = XDefaultRootWindow(displayHandle);
        }
    } catch (e) {
        sendLog('系统', '加载系统光标驱动失败：' + e.message, 'log-err');
        cursorLib = null;
        xfixesLib = null;
        displayHandle = null;
    }
}

/**
 * 隐藏系统光标
 * 进入远程控制/录屏等场景时调用，避免本地光标干扰
 */
function hideCursor() {
    if (!cursorLib || isCursorHidden) return;

    try {
        if (platform === 'win32') {
            const ShowCursor = cursorLib.func('ShowCursor', 'int', ['bool'], { abi: 'stdcall' });
            while (ShowCursor(false) >= 0) {
                // 循环递减光标计数器
            }
        } else if (platform === 'darwin') {
            const CGDisplayHideCursor = cursorLib.func('CGDisplayHideCursor', 'int', ['uint32']);
            CGDisplayHideCursor(0);
        } else if (platform === 'linux' && displayHandle && !koffi.isNull(displayHandle)) {
            const XFixesHideCursor = xfixesLib.func('XFixesHideCursor', 'void', ['pointer', 'uint64']);
            XFixesHideCursor(displayHandle, rootWindow);
        }
        isCursorHidden = true;
    } catch (err) {
        sendLog('系统', '隐藏光标失败：' + err.message, 'log-err');
    }
}

/**
 * 显示/恢复系统光标
 * 退出远程控制/录屏等场景时必须调用，否则光标会一直消失
 */
function showCursor() {
    if (!cursorLib || !isCursorHidden) return;

    try {
        if (platform === 'win32') {
            const ShowCursor = cursorLib.func('ShowCursor', 'int', ['bool'], { abi: 'stdcall' });
            while (ShowCursor(true) < 0) {
                // 循环恢复光标计数器
            }
        } else if (platform === 'darwin') {
            const CGDisplayShowCursor = cursorLib.func('CGDisplayShowCursor', 'int', ['uint32']);
            CGDisplayShowCursor(0);
        } else if (platform === 'linux' && displayHandle && !koffi.isNull(displayHandle)) {
            const XFixesShowCursor = xfixesLib.func('XFixesShowCursor', 'void', ['pointer', 'uint64']);
            XFixesShowCursor(displayHandle, rootWindow);
        }
        isCursorHidden = false;
    } catch (err) {
        sendLog('系统', '恢复光标失败：' + err.message, 'log-err');
    }
}

// ==================== 看门狗子进程逻辑 ====================

/**
 * 检查是否以子进程模式运行（看门狗守护模式）
 * 通过启动参数中是否包含数字 PID 来判断
 * @returns {boolean}
 */
function isWatchdogChild() {
    const lastArg = process.argv[process.argv.length - 1];
    return /^\d+$/.test(lastArg);
}

/**
 * 看门狗子进程入口
 * 轮询检查父进程是否存活，父进程异常退出时恢复光标后退出
 */
function runWatchdogChild() {
    // 子进程模式下不使用 win 对象，也不发送日志到渲染进程
    // 因为子进程是独立的，没有渲染进程

    const parentPid = parseInt(process.argv[process.argv.length - 1], 10);

    // 参数无效，直接退出
    if (isNaN(parentPid)) {
        process.exit(1);
    }

    // 初始化光标控制（子进程模式下 win 为 null，日志会被静默丢弃）
    initCursor(null);

    /**
     * 安全退出：确保光标恢复后再退出
     * 这是最重要的兜底逻辑，无论什么原因退出都要先恢复光标
     */
    function safeExit(code = 0) {
        try {
            showCursor();
        } catch (e) {
            // 忽略恢复失败，尽量退出
        }
        process.exit(code);
    }

    // 轮询检查父进程状态
    const checkInterval = setInterval(() => {
        try {
            // 信号 0 不会杀死进程，仅用于检测进程是否存在
            process.kill(parentPid, 0);
        } catch (e) {
            // 抛出异常说明父进程已经不存在了（被任务管理器强制杀死等）
            clearInterval(checkInterval);
            safeExit(0);
        }
    }, 1000);

    // ========== 各种退出场景的兜底 ==========

    // IPC 管道断开（主进程正常退出时会断开）
    process.on('disconnect', () => {
        clearInterval(checkInterval);
        safeExit(0);
    });

    // 未捕获的 JS 异常
    process.on('uncaughtException', () => {
        clearInterval(checkInterval);
        safeExit(1);
    });

    // 未处理的 Promise 拒绝
    process.on('unhandledRejection', () => {
        clearInterval(checkInterval);
        safeExit(1);
    });

    // 进程即将退出（最后一道防线）
    process.on('exit', () => {
        // 注意：exit 事件中不能执行异步操作
        // showCursor 是同步调用，可以执行
        try {
            showCursor();
        } catch (e) {
            // 忽略
        }
    });

    // SIGINT 信号（Ctrl+C）
    process.on('SIGINT', () => {
        clearInterval(checkInterval);
        safeExit(0);
    });

    // SIGTERM 信号（系统要求终止）
    process.on('SIGTERM', () => {
        clearInterval(checkInterval);
        safeExit(0);
    });
}

// ==================== 主进程看门狗控制 ====================

/**
 * 启动看门狗守护进程
 * 主进程调用此函数后，会启动一个独立的子进程监控自己
 * 当主进程被强制杀死时，看门狗会自动恢复系统光标
 *
 * @param {object} mainWin - 主窗口对象
 */
function startWatchdog(mainWin) {
    // 初始化光标控制
    initCursor(mainWin);

    // 已经启动过则不重复启动
    if (watchdogProcess) return;

    try {
        // 处理开发环境与打包环境的路径兼容
        let watchdogPath = path.join(__dirname, 'watchdog.js');
        if (app.isPackaged) {
            // 打包后，asar 内的脚本需要指向被解包到 app.asar.unpacked 中的绝对路径
            watchdogPath = watchdogPath.replace('app.asar', 'app.asar.unpacked');
        }

        // 使用当前 Electron 可执行文件启动看门狗脚本
        // 传入当前进程 PID 作为被监控对象
        watchdogProcess = spawn(process.execPath, [watchdogPath, String(process.pid)], {
            detached: true,     // 让看门狗成为独立进程组，主进程被杀时它不会被一起强制杀死
            stdio: 'ignore',    // 忽略标准输入输出，使其在后台完全静默运行
            windowsHide: true   // 隐藏 Windows 下的黑色命令行窗口
        });

        // 让父进程不再等待子进程，确保主进程可以自由退出
        watchdogProcess.unref();

        sendLog('系统', `看门狗守护进程已启动，监控 PID: ${process.pid}`, 'log-succ');
    } catch (err) {
        sendLog('系统', '启动看门狗失败：' + err.message, 'log-err');
        watchdogProcess = null;
    }
}

/**
 * 停止看门狗守护进程
 * 主进程正常退出时调用，温柔地结束看门狗
 */
function stopWatchdog() {
    if (watchdogProcess) {
        try {
            watchdogProcess.kill();
        } catch (e) {
            // 忽略杀死失败
        }
        watchdogProcess = null;
        sendLog('系统', '看门狗已安全关闭', 'log-succ');
    }

    // 确保光标恢复
    showCursor();
}

// ==================== 子进程模式自动执行 ====================

// 如果是以子进程模式启动（命令行参数最后一个是数字 PID），则直接进入看门狗逻辑
if (isWatchdogChild()) {
    runWatchdogChild();
}

// ==================== 导出主进程 API ====================

module.exports = {
    startWatchdog,
    stopWatchdog,
    hideCursor,
    showCursor
};