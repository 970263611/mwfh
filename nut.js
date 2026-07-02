const nutjs = require('@nut-tree-fork/nut-js');
const {screen} = require('electron');
const os = require('os');

/**
 * 键鼠事件播放器（被控端执行远程操作）
 * 接收归一化坐标的键鼠事件，转换为本地屏幕坐标后执行
 */
class MouseKeyboardPlayer {
    constructor() {
        // 获取主显示器信息
        this.display = screen.getPrimaryDisplay();
        this.screenW = this.display.size.width;
        this.screenH = this.display.size.height;

        // 记录当前按下的键和鼠标按钮（用于释放）
        this.pressedKeys = new Set();
        this.pressedMouseBtn = new Set();

        nutjs.mouse.config.mouseSpeed = 0
        nutjs.mouse.config.autoDelayMs = 0

        // 平台判断：Mac 上 Meta 键是 Cmd，其他系统是 Win/Super
        this.isMac = os.platform() === 'darwin';

        // 修饰键映射表（浏览器 e.code → nut.js Key）
        // 注意：nut-js 的 Key 枚举中没有统一的 Command/Super，需要区分左右
        this.modifierMap = {
            MetaLeft: this.isMac ? nutjs.Key.LeftCmd : nutjs.Key.LeftWin,
            MetaRight: this.isMac ? nutjs.Key.RightCmd : nutjs.Key.RightWin,
            OSLeft: this.isMac ? nutjs.Key.LeftCmd : nutjs.Key.LeftWin,
            OSRight: this.isMac ? nutjs.Key.RightCmd : nutjs.Key.RightWin,
            ControlLeft: nutjs.Key.LeftControl,
            ControlRight: nutjs.Key.RightControl,
            ShiftLeft: nutjs.Key.LeftShift,
            ShiftRight: nutjs.Key.RightShift,
            AltLeft: nutjs.Key.LeftAlt,
            AltRight: nutjs.Key.RightAlt
        };

        // 完整键盘码映射表（浏览器 e.code → nut.js Key）
        this.keyCodeMap = {
            // 功能键
            Escape: nutjs.Key.Escape,
            F1: nutjs.Key.F1,
            F2: nutjs.Key.F2,
            F3: nutjs.Key.F3,
            F4: nutjs.Key.F4,
            F5: nutjs.Key.F5,
            F6: nutjs.Key.F6,
            F7: nutjs.Key.F7,
            F8: nutjs.Key.F8,
            F9: nutjs.Key.F9,
            F10: nutjs.Key.F10,
            F11: nutjs.Key.F11,
            F12: nutjs.Key.F12,
            PrintScreen: nutjs.Key.Print,
            ScrollLock: nutjs.Key.ScrollLock,
            Pause: nutjs.Key.Pause,

            // 数字行
            Backquote: nutjs.Key.Grave,
            Digit1: nutjs.Key.Num1,
            Digit2: nutjs.Key.Num2,
            Digit3: nutjs.Key.Num3,
            Digit4: nutjs.Key.Num4,
            Digit5: nutjs.Key.Num5,
            Digit6: nutjs.Key.Num6,
            Digit7: nutjs.Key.Num7,
            Digit8: nutjs.Key.Num8,
            Digit9: nutjs.Key.Num9,
            Digit0: nutjs.Key.Num0,
            Minus: nutjs.Key.Minus,
            Equal: nutjs.Key.Equal,
            Backspace: nutjs.Key.Backspace,

            // 编辑键区
            Insert: nutjs.Key.Insert,
            Home: nutjs.Key.Home,
            PageUp: nutjs.Key.PageUp,
            Delete: nutjs.Key.Delete,
            End: nutjs.Key.End,
            PageDown: nutjs.Key.PageDown,

            // 导航键
            Tab: nutjs.Key.Tab,
            CapsLock: nutjs.Key.CapsLock,
            Enter: nutjs.Key.Enter,
            Space: nutjs.Key.Space,
            ArrowUp: nutjs.Key.Up,
            ArrowDown: nutjs.Key.Down,
            ArrowLeft: nutjs.Key.Left,
            ArrowRight: nutjs.Key.Right,

            // 字母行（第一行）
            KeyQ: nutjs.Key.Q,
            KeyW: nutjs.Key.W,
            KeyE: nutjs.Key.E,
            KeyR: nutjs.Key.R,
            KeyT: nutjs.Key.T,
            KeyY: nutjs.Key.Y,
            KeyU: nutjs.Key.U,
            KeyI: nutjs.Key.I,
            KeyO: nutjs.Key.O,
            KeyP: nutjs.Key.P,
            BracketLeft: nutjs.Key.LeftBracket,
            BracketRight: nutjs.Key.RightBracket,
            Backslash: nutjs.Key.Backslash,

            // 字母行（第二行）
            KeyA: nutjs.Key.A,
            KeyS: nutjs.Key.S,
            KeyD: nutjs.Key.D,
            KeyF: nutjs.Key.F,
            KeyG: nutjs.Key.G,
            KeyH: nutjs.Key.H,
            KeyJ: nutjs.Key.J,
            KeyK: nutjs.Key.K,
            KeyL: nutjs.Key.L,
            Semicolon: nutjs.Key.Semicolon,
            Quote: nutjs.Key.Quote,

            // 字母行（第三行）
            KeyZ: nutjs.Key.Z,
            KeyX: nutjs.Key.X,
            KeyC: nutjs.Key.C,
            KeyV: nutjs.Key.V,
            KeyB: nutjs.Key.B,
            KeyN: nutjs.Key.N,
            KeyM: nutjs.Key.M,
            Comma: nutjs.Key.Comma,
            Period: nutjs.Key.Period,
            Slash: nutjs.Key.Slash,

            // 数字小键盘
            Numpad0: nutjs.Key.NumPad0,
            Numpad1: nutjs.Key.NumPad1,
            Numpad2: nutjs.Key.NumPad2,
            Numpad3: nutjs.Key.NumPad3,
            Numpad4: nutjs.Key.NumPad4,
            Numpad5: nutjs.Key.NumPad5,
            Numpad6: nutjs.Key.NumPad6,
            Numpad7: nutjs.Key.NumPad7,
            Numpad8: nutjs.Key.NumPad8,
            Numpad9: nutjs.Key.NumPad9,
            NumpadAdd: nutjs.Key.Add,
            NumpadSubtract: nutjs.Key.Subtract,
            NumpadMultiply: nutjs.Key.Multiply,
            NumpadDivide: nutjs.Key.Divide,
            NumpadDecimal: nutjs.Key.Decimal,
            NumpadEnter: nutjs.Key.Enter,
            NumLock: nutjs.Key.NumLock,

            // 其他
            ContextMenu: nutjs.Key.Menu,
            OSLeft: this.isMac ? nutjs.Key.LeftCmd : nutjs.Key.LeftWin,
            OSRight: this.isMac ? nutjs.Key.RightCmd : nutjs.Key.RightWin
        };

        // 鼠标按钮映射表（0=左键, 1=中键, 2=右键, 3/4=侧键）
        this.mouseBtnMap = {
            0: nutjs.Button.LEFT,
            1: nutjs.Button.MIDDLE,
            2: nutjs.Button.RIGHT
        };

        // 鼠标平滑移动相关
        this.latestMousePos = null;       // 最新的目标位置（归一化坐标）
        this.mouseFrameInterval = null;   // 鼠标渲染循环定时器
        this.frameRate = 16;              // 渲染帧率（约 60fps）
        this.smoothFactor = 0.85;         // 平滑系数，越大越跟手
        this.isFirstMove = true;          // 是否第一次移动（不平滑）
        this.lastTargetPx = 0;            // 上一次的目标像素 X
        this.lastTargetPy = 0;            // 上一次的目标像素 Y

        // 每秒刷新一次屏幕信息（应对分辨率变化）
        this.screenTimer = setInterval(() => this.#refreshScreen(), 1000);
        // 启动鼠标渲染循环
        this.#startMouseRenderLoop();
    }

    /** 刷新屏幕尺寸（每秒调用一次） */
    #refreshScreen() {
        this.display = screen.getPrimaryDisplay();
        this.screenW = this.display.size.width;
        this.screenH = this.display.size.height;
    }

    /**
     * 键盘码转换：浏览器 e.code → nut.js Key
     * @param {string} code - 浏览器事件的 code 字段
     * @returns {nutjs.Key|null}
     */
    #convertKeyCode(code) {
        if (!code || typeof code !== 'string') return null;
        // 优先从完整映射表查找
        if (this.keyCodeMap[code] !== undefined) return this.keyCodeMap[code];
        // 修饰键兜底
        if (this.modifierMap[code]) return this.modifierMap[code];
        // 未找到的键返回 null，避免错误输入
        return null;
    }

    /**
     * 归一化坐标转像素坐标（带平滑插值）
     * @param {number} normX - 归一化 X (0~1)
     * @param {number} normY - 归一化 Y (0~1)
     * @returns {{px: number, py: number}}
     */
    #normToPixel(normX, normY) {
        let targetX = normX * this.screenW;
        let targetY = normY * this.screenH;

        if (this.isFirstMove) {
            // 第一次移动直接定位，不平滑
            this.isFirstMove = false;
            this.lastTargetPx = targetX;
            this.lastTargetPy = targetY;
        } else {
            // 平滑插值：向目标位置靠近 smoothFactor 的比例
            targetX = this.lastTargetPx + (targetX - this.lastTargetPx) * this.smoothFactor;
            targetY = this.lastTargetPy + (targetY - this.lastTargetPy) * this.smoothFactor;
            this.lastTargetPx = targetX;
            this.lastTargetPy = targetY;
        }

        // 边界限制，确保不超出屏幕
        const px = Math.max(0, Math.min(this.screenW - 1, Math.round(targetX)));
        const py = Math.max(0, Math.min(this.screenH - 1, Math.round(targetY)));
        return {px, py};
    }

    /** 启动鼠标渲染循环（独立线程处理移动，避免事件阻塞） */
    #startMouseRenderLoop() {
        if (this.mouseFrameInterval) return;
        this.mouseFrameInterval = setInterval(async () => {
            if (!this.latestMousePos) return;
            try {
                const {x, y} = this.latestMousePos;
                const {px, py} = this.#normToPixel(x, y);
                await nutjs.mouse.setPosition({x: px, y: py});
                this.latestMousePos = null;
            } catch (e) {
                // 静默失败
            }
        }, this.frameRate);
    }

    /**
     * 播放单个键鼠事件
     * @param {object} evt - 事件对象 {t, x, y, b, c, dy, ...}
     * @returns {boolean} 是否成功
     */
    async play(evt) {
        if (!evt?.t) return false;
        try {
            switch (evt.t) {
                case 'screen':
                    // 屏幕信息事件，忽略
                    return true;
                case 'releaseAll':
                    // 释放所有按键（窗口失焦时调用）
                    await this.releaseAll();
                    return true;
                case 'move':
                    // 鼠标移动：更新最新位置，由渲染循环处理
                    this.latestMousePos = {x: evt.x, y: evt.y};
                    break;
                case 'down': {
                    // 鼠标按下：先强制移动到目标位置，再点击
                    if (evt.x !== undefined && evt.y !== undefined) {
                        // 点击时使用精确位置，不做平滑插值
                        const px = Math.max(0, Math.min(this.screenW - 1, Math.round(evt.x * this.screenW)));
                        const py = Math.max(0, Math.min(this.screenH - 1, Math.round(evt.y * this.screenH)));
                        await nutjs.mouse.setPosition({x: px, y: py});
                        // 更新平滑移动的目标位置，避免后续移动跳变
                        this.lastTargetPx = px;
                        this.lastTargetPy = py;
                    }
                    const btn = this.mouseBtnMap[evt.b] ?? nutjs.Button.LEFT;
                    await nutjs.mouse.pressButton(btn);
                    this.pressedMouseBtn.add(btn);
                    break;
                }
                case 'up': {
                    // 鼠标抬起：先强制移动到目标位置，再抬起
                    if (evt.x !== undefined && evt.y !== undefined) {
                        // 点击时使用精确位置，不做平滑插值
                        const px = Math.max(0, Math.min(this.screenW - 1, Math.round(evt.x * this.screenW)));
                        const py = Math.max(0, Math.min(this.screenH - 1, Math.round(evt.y * this.screenH)));
                        await nutjs.mouse.setPosition({x: px, y: py});
                        this.lastTargetPx = px;
                        this.lastTargetPy = py;
                    }
                    const btn = this.mouseBtnMap[evt.b] ?? nutjs.Button.LEFT;
                    await nutjs.mouse.releaseButton(btn);
                    this.pressedMouseBtn.delete(btn);
                    break;
                }
                case 'wheel': {
                    // 鼠标滚轮：dy 为像素数，转换为 nut.js 的滚动步数
                    const step = Math.sign(evt.dy) * Math.min(Math.abs(evt.dy / 100), 3);
                    if (step > 0) await nutjs.mouse.scrollUp(Math.abs(step));
                    if (step < 0) await nutjs.mouse.scrollDown(Math.abs(step));
                    break;
                }
                case 'kd': {
                    // 键盘按下
                    const key = this.#convertKeyCode(evt.c);
                    if (!key) break;
                    await nutjs.keyboard.pressKey(key);
                    this.pressedKeys.add(key);
                    break;
                }
                case 'ku': {
                    // 键盘抬起
                    const key = this.#convertKeyCode(evt.c);
                    if (!key) break;
                    await nutjs.keyboard.releaseKey(key);
                    this.pressedKeys.delete(key);
                    break;
                }
                default:
                    // 未知事件类型，忽略
                    break;
            }
            return true;
        } catch (err) {
            return false;
        }
    }

    /**
     * 批量播放事件（带间隔）
     * @param {object[]} eventArr - 事件数组
     * @param {number} delayMs - 每个事件间隔毫秒数
     * @returns {boolean}
     */
    async playBatch(eventArr, delayMs = 8) {
        if (!Array.isArray(eventArr) || eventArr.length === 0) return false;
        for (const item of eventArr) {
            this.play(item);
            await new Promise(r => setTimeout(r, delayMs));
        }
        return true;
    }

    /**
     * 释放所有按下的键和鼠标按钮
     * @param {string[]} rawKeyCodeList - 额外要释放的键码列表
     */
    async releaseAll(rawKeyCodeList = []) {
        // 释放所有记录的按键
        for (const k of this.pressedKeys) await nutjs.keyboard.releaseKey(k);
        this.pressedKeys.clear();
        // 释放额外指定的键
        for (const code of rawKeyCodeList) {
            const k = this.#convertKeyCode(code);
            if (k) await nutjs.keyboard.releaseKey(k);
        }
        // 释放所有鼠标按钮
        for (const btn of this.pressedMouseBtn) await nutjs.mouse.releaseButton(btn);
        this.pressedMouseBtn.clear();
    }

    /** 销毁播放器，释放所有资源 */
    async destroy() {
        try {
            await this.releaseAll();
            clearInterval(this.screenTimer);
            if (this.mouseFrameInterval) {
                clearInterval(this.mouseFrameInterval);
                this.mouseFrameInterval = null;
            }
        } catch (e) {
            // 静默失败
        }
        this.latestMousePos = null;
        this.isFirstMove = true;
    }
}

// 单例实例
let player = null;

/** 启动键鼠播放器（单例） */
function start() {
    if (!player) player = new MouseKeyboardPlayer();
}

/** 播放单个输入事件 */
async function playInput(evt) {
    if (player) await player.play(evt);
}

/** 销毁播放器 */
async function destroy() {
    if (player) {
        await player.destroy();
        player = null;
    }
}

module.exports = {start, playInput, destroy};
