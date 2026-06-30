const robot = require("robotjs");
const os = require("os");

let win
let player

class MouseKeyboardPlayer {
    constructor() {
        this.renderTimer = null;
        this.#updateScreenInfo();
        this.masterScreen = { w: 0, h: 0 };

        this.pressedKeys = new Set();
        this.pressedMouseBtn = new Set();

        this.metaKey = os.platform() === "darwin" ? "command" : "win";
        this.modifierMap = {
            MetaLeft: this.metaKey, MetaRight: this.metaKey,
            ControlLeft: "control", ControlRight: "control",
            ShiftLeft: "shift", ShiftRight: "shift",
            AltLeft: "alt", AltRight: "alt"
        };

        this.mouseBtnMap = { 0: "left", 1: "middle", 2: "right", 3: "x1", 4: "x2" };

        // 时序鼠标缓存栈（最多保留100ms内点位）
        this.mousePointStack = [];
        this.renderLock = false;

        // 平滑插值基准
        this.lastTargetPx = 0;
        this.lastTargetPy = 0;
        this.lastRenderTs = Date.now();

        this.screenChangeTimer = setInterval(() => this.#updateScreenInfo(), 1000);
        // 启动鼠标持续渲染循环（Node定时器替代raf，修复主进程报错）
        this.#startMouseRenderLoop();
    }

    #updateScreenInfo() {
        const screen = robot.getScreenSize();
        this.screenW = screen.width;
        this.screenH = screen.height;
    }

    #convertKeyCode(code) {
        if (!code || typeof code !== "string") return "";
        if (this.modifierMap[code]) return this.modifierMap[code];
        if (code.startsWith("Key")) return code.slice(3).toLowerCase();
        if (code.startsWith("Digit")) return code.slice(5);
        return code.toLowerCase();
    }

    // 归一坐标转本机像素 + 动态平滑
    #normToPixel(normX, normY, speedFactor = 1) {
        const { w: masterW, h: masterH } = this.masterScreen;
        let targetX, targetY;

        if (masterW <= 0 || masterH <= 0) {
            targetX = normX * this.screenW;
            targetY = normY * this.screenH;
        } else {
            const masterPx = normX * masterW;
            const masterPy = normY * masterH;
            targetX = (masterPx / masterW) * this.screenW;
            targetY = (masterPy / masterH) * this.screenH;
        }

        // 动态平滑：移动越快平滑系数越高，响应越快
        const dist = Math.hypot(targetX - this.lastTargetPx, targetY - this.lastTargetPy);
        const baseSmooth = 0.3;
        let smoothFactor = baseSmooth;
        if (dist > 50) smoothFactor = 0.65;
        else if (dist > 15) smoothFactor = 0.45;

        smoothFactor *= speedFactor;

        targetX = this.lastTargetPx + (targetX - this.lastTargetPx) * smoothFactor;
        targetY = this.lastTargetPy + (targetY - this.lastTargetPy) * smoothFactor;

        this.lastTargetPx = targetX;
        this.lastTargetPy = targetY;

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

    // 清理超时过期点位（超过100ms直接丢弃，解决滞后堆积）
    #pruneExpiredPoints() {
        const now = Date.now();
        const expireThreshold = now - 100;
        while (this.mousePointStack.length && this.mousePointStack[0].ts < expireThreshold) {
            this.mousePointStack.shift();
        }
    }

    // Node主进程专用渲染循环，setInterval替代requestAnimationFrame
    #startMouseRenderLoop() {
        // 60帧刷新率，等价浏览器raf
        const FPS = 60;
        const intervalMs = Math.round(1000 / FPS);
        this.renderTimer = setInterval(() => {
            if (this.renderLock) return;
            this.renderLock = true;
            try {
                this.#pruneExpiredPoints();
                const stack = this.mousePointStack;
                if (stack.length < 2) {
                    // 不足两个点不插值
                    if (stack.length === 1) {
                        const p = stack[0];
                        const { px, py } = this.#normToPixel(p.x, p.y);
                        robot.moveMouse(px, py);
                    }
                    return;
                }

                const now = Date.now();
                const p0 = stack[0];
                const p1 = stack[stack.length - 1];
                const deltaTs = p1.ts - p0.ts;
                const currOffset = now - p0.ts;

                // 时间插值系数 0~1
                let t = deltaTs === 0 ? 1 : currOffset / deltaTs;
                t = Math.max(0, Math.min(1, t));

                // 插值归一坐标
                const interpX = p0.x * (1 - t) + p1.x * t;
                const interpY = p0.y * (1 - t);

                // 根据移动速度调整响应力度
                const moveDist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
                const speed = moveDist / deltaTs;
                const speedFactor = Math.min(1.8, 1 + speed * 800);

                const { px, py } = this.#normToPixel(interpX, interpY, speedFactor);
                robot.moveMouse(px, py);
            } catch (e) {
                this.#log("鼠标渲染循环异常", e.message);
            } finally {
                this.renderLock = false;
            }
        }, intervalMs);
    }

    play(evt) {
        if (!evt?.t) {
            this.#log("无效事件，缺少t字段", evt);
            return false;
        }
        const ts = evt.ts || Date.now();
        try {
            switch (evt.t) {
                case "screen":
                    this.masterScreen.w = evt.sw;
                    this.masterScreen.h = evt.sh;
                    return true;

                case "calibrate":
                    // 强制校准，清空时序栈，消除累积偏移
                    this.mousePointStack.length = 0;
                    this.lastTargetPx = evt.x * this.masterScreen.w;
                    this.lastTargetPy = evt.y * this.masterScreen.h;
                    const cal = this.#normToPixel(evt.x, evt.y, 1);
                    robot.moveMouse(cal.px, cal.py);
                    return true;

                case "move":
                    // 推入时序栈，渲染循环统一处理
                    this.mousePointStack.push({
                        x: evt.x,
                        y: evt.y,
                        ts
                    });
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
                    // 滚轮幅度限制，适配不同系统滚动手感
                    const dy = Math.sign(evt.dy) * Math.min(Math.abs(evt.dy), 35);
                    robot.scrollMouse(0, dy);
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
            // 销毁鼠标渲染定时器，防止后台循环泄漏
            if (this.renderTimer) clearInterval(this.renderTimer);
        } catch (e) {
            this.#log("销毁释放资源异常：", e.message);
        }
        this.mousePointStack.length = 0;
        this.pressedKeys.clear();
        this.pressedMouseBtn.clear();
        this.screenW = 0;
        this.screenH = 0;
        this.masterScreen = { w: 0, h: 0 };
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