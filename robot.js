const robot = require("robotjs");
const os = require("os");
let win
let player

class MouseKeyboardPlayer {
    constructor() {
        this.#updateScreenInfo();
        this.masterScreen = {w: 0, h: 0};

        // 按键状态缓存
        this.pressedKeys = new Set();
        this.pressedMouseBtn = new Set();

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

        this.mouseBtnMap = {
            0: "left",
            1: "middle",
            2: "right",
            3: "x1",
            4: "x2"
        };

        // 优化1：鼠标最新坐标队列，只保留最后一帧
        this.latestMousePos = null;
        // 优化2：固定60fps刷新鼠标，避免重复调度和阻塞
        this.mouseFrameInterval = null;
        this.frameRate = 16; // 60fps

        // 优化3：平滑插值修复 - 标记首次执行，避免从左上角漂移
        this.isFirstMove = true;
        this.lastTargetPx = 0;
        this.lastTargetPy = 0;
        // 平滑因子调到0.85，仅轻微防抖，保证跟手性
        this.smoothFactor = 0.85;

        this.screenChangeTimer = setInterval(() => this.#updateScreenInfo(), 1000);

        // 启动鼠标固定刷新率渲染
        this.#startMouseRenderLoop();
    }

    #updateScreenInfo() {
        const screen = robot.getScreenSize();
        this.screenW = screen.width;
        this.screenH = screen.height;
    }

    #convertKeyCode(code) {
        if (!code || typeof code !== "string") return "";
        if (this.modifierMap.hasOwnProperty(code)) return this.modifierMap[code];
        if (code.startsWith("Key")) return code.slice(3).toLowerCase();
        if (code.startsWith("Digit")) return code.slice(5);
        return code.toLowerCase();
    }

    // 优化4：核心修复 - 坐标映射算法，移除错误的主控屏幕尺寸换算
    #normToPixel(normX, normY) {
        // 直接用归一化坐标 × 被控端屏幕分辨率，基准完全统一
        let targetX = normX * this.screenW;
        let targetY = normY * this.screenH;

        // 首次移动直接定位，不插值，避免从左上角飘过来
        if (this.isFirstMove) {
            this.isFirstMove = false;
            this.lastTargetPx = targetX;
            this.lastTargetPy = targetY;
        } else {
            // 轻微平滑，只消抖不拖影
            targetX = this.lastTargetPx + (targetX - this.lastTargetPx) * this.smoothFactor;
            targetY = this.lastTargetPy + (targetY - this.lastTargetPy) * this.smoothFactor;
            this.lastTargetPx = targetX;
            this.lastTargetPy = targetY;
        }

        // 边界限制
        const px = Math.max(0, Math.min(this.screenW - 1, Math.round(targetX)));
        const py = Math.max(0, Math.min(this.screenH - 1, Math.round(targetY)));
        return {px, py};
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

    // 优化5：启动固定帧率鼠标渲染循环，彻底解决消息堆积卡顿
    #startMouseRenderLoop() {
        if (this.mouseFrameInterval) return;
        this.mouseFrameInterval = setInterval(() => {
            if (!this.latestMousePos) return;
            try {
                const {x, y} = this.latestMousePos;
                const {px, py} = this.#normToPixel(x, y);
                robot.moveMouse(px, py);
                // 消费完清空，避免重复渲染同一帧
                this.latestMousePos = null;
            } catch (e) {
                this.#log("鼠标移动失败", e.message);
            }
        }, this.frameRate);
    }

    play(evt) {
        if (!evt?.t) {
            this.#log("无效事件，缺少t字段", evt);
            return false;
        }
        try {
            switch (evt.t) {
                case "screen":
                    this.masterScreen.w = evt.sw;
                    this.masterScreen.h = evt.sh;
                    return true;

                case "move":
                    // 只保留最新坐标，由渲染循环统一消费
                    this.latestMousePos = {x: evt.x, y: evt.y};
                    break;

                case "down": {
                    const btnName = this.mouseBtnMap[evt.b] || "left";
                    robot.mouseToggle("down", btnName);
                    this.pressedMouseBtn.add(btnName);
                    break;
                }

                case "up": {
                    const btnName = this.mouseBtnMap[evt.b] || "left";
                    robot.mouseToggle("up", btnName);
                    this.pressedMouseBtn.delete(btnName);
                    break;
                }

                case "wheel":
                    // 优化滚动量映射，按系统刻度归一
                    const scrollAmount = Math.sign(evt.dy) * Math.min(Math.abs(evt.dy / 100), 3);
                    robot.scrollMouse(0, scrollAmount);
                    break;

                case "kd": {
                    const key = this.#convertKeyCode(evt.c);
                    if (!key) break;
                    robot.keyToggle(key, "down");
                    this.pressedKeys.add(key);
                    break;
                }

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

    releaseAll(rawKeyCodeList = []) {
        for (const key of this.pressedKeys) {
            robot.keyToggle(key, "up");
        }
        this.pressedKeys.clear();
        rawKeyCodeList.forEach(code => {
            const key = this.#convertKeyCode(code);
            if (key) robot.keyToggle(key, "up");
        });
        for (const btn of this.pressedMouseBtn) {
            robot.mouseToggle("up", btn);
        }
        this.pressedMouseBtn.clear();
    }

    destroy() {
        try {
            this.releaseAll();
            clearInterval(this.screenChangeTimer);
            // 销毁鼠标渲染循环
            if (this.mouseFrameInterval) {
                clearInterval(this.mouseFrameInterval);
                this.mouseFrameInterval = null;
            }
        } catch (e) {
            this.#log("销毁释放资源异常：", e.message);
        }
        this.latestMousePos = null;
        this.pressedKeys.clear();
        this.pressedMouseBtn.clear();
        this.screenW = 0;
        this.screenH = 0;
        this.masterScreen = {w: 0, h: 0};
    }
}

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