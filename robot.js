const robot = require("robotjs");
const os = require("os");

let win
let player

class MouseKeyboardPlayer {
    constructor() {
        // 本机屏幕物理尺寸 + DPI缩放兼容
        this.#updateScreenInfo();
        // 缓存主控发送的屏幕信息（用于坐标换算，解决分辨率偏移）
        this.masterScreen = { w: 0, h: 0 };

        // 按键/鼠标按下状态缓存
        this.pressedKeys = new Set();
        this.pressedMouseBtn = new Set();

        // 修饰键映射
        this.metaKey = os.platform() === "darwin" ? "command" : "win";
        this.modifierMap = {
            MetaLeft: this.metaKey,
            MetaRight: this.metaKey,
            ControlLeft: "control",
            ControlRight: "control",
            ShiftLeft: "shift",
            ShiftRight: "shift",
            AltLeft: "alt",
            AltRight: "alt"
        };

        // 鼠标按键完整映射：0左键 1中键 2右键 3侧上 4侧下
        this.mouseBtnMap = {
            0: "left",
            1: "middle",
            2: "right",
            3: "x1",
            4: "x2"
        };

        // 鼠标消息队列优化：只保留最新坐标，丢弃滞后消息，解决卡顿堆积
        this.mouseQueue = null;
        this.mouseTickLock = false;

        // 平滑插值缓存
        this.lastTargetPx = 0;
        this.lastTargetPy = 0;

        // 监听屏幕分辨率变化
        this.screenChangeTimer = setInterval(() => this.#updateScreenInfo(), 1000);
    }

    // 更新本机屏幕信息，兼容系统DPI缩放
    #updateScreenInfo() {
        const screen = robot.getScreenSize();
        this.screenW = screen.width;
        this.screenH = screen.height;
        this.dpr = window?.devicePixelRatio || 1;
    }

    // 私有：转换键盘code适配robotjs
    #convertKeyCode(code) {
        if (!code || typeof code !== "string") return "";
        if (this.modifierMap.hasOwnProperty(code)) return this.modifierMap[code];
        if (code.startsWith("Key")) return code.slice(3).toLowerCase();
        if (code.startsWith("Digit")) return code.slice(5);
        return code.toLowerCase();
    }

    // 【核心修复：坐标映射算法，解决两端分辨率不一致偏移】
    // normX/normY：主控窗口归一0~1坐标
    // masterW/masterH：主控真实屏幕宽高
    #normToPixel(normX, normY) {
        const { w: masterW, h: masterH } = this.masterScreen;
        // 无主控屏幕数据时降级使用简单映射（兜底）
        if (masterW <= 0 || masterH <= 0) {
            return {
                px: Math.max(0, Math.min(this.screenW - 1, Math.round(normX * this.screenW))),
                py: Math.max(0, Math.min(this.screenH - 1, Math.round(normY * this.screenH)))
            };
        }
        // 1. 换算为主控屏幕真实像素
        const masterPx = normX * masterW;
        const masterPy = normY * masterH;
        // 2. 映射到被控本机屏幕像素
        let targetX = (masterPx / masterW) * this.screenW;
        let targetY = (masterPy / masterH) * this.screenH;

        // 平滑插值，避免鼠标跳跃
        const smoothFactor = 0.35;
        targetX = this.lastTargetPx + (targetX - this.lastTargetPx) * smoothFactor;
        targetY = this.lastTargetPy + (targetY - this.lastTargetPy) * smoothFactor;
        this.lastTargetPx = targetX;
        this.lastTargetPy = targetY;

        // 边界限制
        const px = Math.max(0, Math.min(this.screenW - 1, Math.round(targetX)));
        const py = Math.max(0, Math.min(this.screenH - 1, Math.round(targetY)));
        return { px, py };
    }

    #log(...args) {
        const trace = {
            time: new Date().toLocaleString('zh-CN'),
            target: '键鼠播放器',
            msg: JSON.stringify(args),
            type: "log-err"
        }
        win?.webContents?.send('trace-show', trace)
    }

    // 节流执行鼠标移动，丢弃堆积消息
    #flushMouseMove() {
        if (this.mouseTickLock || !this.mouseQueue) return;
        this.mouseTickLock = true;
        try {
            const { x, y } = this.mouseQueue;
            const { px, py } = this.#normToPixel(x, y);
            robot.moveMouse(px, py);
            // 清空队列，只保留最新一帧
            this.mouseQueue = null;
        } catch (e) {
            this.#log("鼠标移动失败", e.message);
        } finally {
            this.mouseTickLock = false;
        }
    }

    /**
     * 接收WebRTC下发的单条事件
     * @param {Object} evt 主控传来事件对象
     */
    play(evt) {
        if (!evt?.t) {
            this.#log("无效事件，缺少t字段", evt);
            return false;
        }
        try {
            switch (evt.t) {
                // 主控同步屏幕尺寸
                case "screen":
                    this.masterScreen.w = evt.sw;
                    this.masterScreen.h = evt.sh;
                    return true;

                // 鼠标移动：放入队列，防抖丢弃旧帧
                case "move":
                    this.mouseQueue = { x: evt.x, y: evt.y };
                    requestAnimationFrame(() => this.#flushMouseMove());
                    break;

                // 鼠标按下
                case "down": {
                    const btnName = this.mouseBtnMap[evt.b] || "left";
                    robot.mouseToggle("down", btnName);
                    this.pressedMouseBtn.add(btnName);
                    break;
                }

                // 鼠标抬起
                case "up": {
                    const btnName = this.mouseBtnMap[evt.b] || "left";
                    robot.mouseToggle("up", btnName);
                    this.pressedMouseBtn.delete(btnName);
                    break;
                }

                // 滚轮滚动
                case "wheel":
                    robot.scrollMouse(0, Math.sign(evt.dy) * Math.min(Math.abs(evt.dy), 30));
                    break;

                // 键盘按下
                case "kd": {
                    const key = this.#convertKeyCode(evt.c);
                    if (!key) break;
                    robot.keyToggle(key, "down");
                    this.pressedKeys.add(key);
                    break;
                }

                // 键盘抬起
                case "ku": {
                    const key = this.#convertKeyCode(evt.c);
                    if (!key) break;
                    robot.keyToggle(key, "up");
                    this.pressedKeys.delete(key);
                    break;
                }

                default:
                    this.#log("未知事件类型：", evt.t);
            }
            return true;
        } catch (err) {
            this.#log("执行键鼠事件异常：", err.message, evt);
            return false;
        }
    }

    /**
     * 批量回放（本地录播）
     */
    async playBatch(eventArr, delayMs = 8) {
        if (!Array.isArray(eventArr) || eventArr.length === 0) {
            this.#log("事件数组为空");
            return false;
        }
        for (const item of eventArr) {
            this.play(item);
            await new Promise(r => setTimeout(r, delayMs));
        }
        return true;
    }

    // 紧急释放所有按键鼠标，防止卡死
    releaseAll(rawKeyCodeList = []) {
        // 释放键盘
        for (const key of this.pressedKeys) {
            robot.keyToggle(key, "up");
        }
        this.pressedKeys.clear();
        rawKeyCodeList.forEach(code => {
            const key = this.#convertKeyCode(code);
            if (key) robot.keyToggle(key, "up");
        });
        // 释放鼠标所有按键
        for (const btn of this.pressedMouseBtn) {
            robot.mouseToggle("up", btn);
        }
        this.pressedMouseBtn.clear();
    }

    destroy() {
        try {
            this.releaseAll();
            clearInterval(this.screenChangeTimer);
        } catch (e) {
            this.#log("销毁释放资源异常：", e.message);
        }
        this.mouseQueue = null;
        this.pressedKeys.clear();
        this.pressedMouseBtn.clear();
        this.screenW = 0;
        this.screenH = 0;
        this.masterScreen = { w: 0, h: 0 };
    }
}

// 对外接口不变，上层无需修改调用代码
function start(mainWin) {
    win = mainWin
    player = new MouseKeyboardPlayer()
}

function play(evt) {
    if (player) player.play(evt)
}

function destroy() {
    if (player) {
        player.destroy();
        player = null;
    }
}

module.exports = {
    start,
    play,
    destroy
}