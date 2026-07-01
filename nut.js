const nutjs = require("@nut-tree-fork/nut-js");
const {screen} = require("electron");
const os = require("os");

class MouseKeyboardPlayer {
    constructor() {
        this.display = screen.getPrimaryDisplay();
        this.screenW = this.display.size.width;
        this.screenH = this.display.size.height;

        this.pressedKeys = new Set();
        this.pressedMouseBtn = new Set();

        this.isMac = os.platform() === "darwin";
        this.metaKey = this.isMac ? nutjs.Key.Command : nutjs.Key.Super;
        this.modifierMap = {
            MetaLeft: this.metaKey,
            MetaRight: this.metaKey,
            ControlLeft: nutjs.Key.Control,
            ControlRight: nutjs.Key.Control,
            ShiftLeft: nutjs.Key.Shift,
            ShiftRight: nutjs.Key.Shift,
            AltLeft: nutjs.Key.Alt,
            AltRight: nutjs.Key.Alt
        };

        this.mouseBtnMap = {
            0: nutjs.Button.LEFT,
            1: nutjs.Button.MIDDLE,
            2: nutjs.Button.RIGHT,
            3: nutjs.Button.X1,
            4: nutjs.Button.X2
        };

        this.latestMousePos = null;
        this.mouseFrameInterval = null;
        this.frameRate = 16;
        this.smoothFactor = 0.85;
        this.isFirstMove = true;
        this.lastTargetPx = 0;
        this.lastTargetPy = 0;

        this.screenTimer = setInterval(() => this.#refreshScreen(), 1000);
        this.#startMouseRenderLoop();
    }

    #refreshScreen() {
        this.display = screen.getPrimaryDisplay();
        this.screenW = this.display.size.width;
        this.screenH = this.display.size.height;
    }

    #convertKeyCode(code) {
        if (!code || typeof code !== "string") return null;
        if (this.modifierMap[code]) return this.modifierMap[code];
        if (code.startsWith("Key")) return nutjs.Key[code.slice(3).toUpperCase()];
        if (code.startsWith("Digit")) return code.slice(5);
        return code.toLowerCase();
    }

    #normToPixel(normX, normY) {
        let targetX = normX * this.screenW;
        let targetY = normY * this.screenH;

        if (this.isFirstMove) {
            this.isFirstMove = false;
            this.lastTargetPx = targetX;
            this.lastTargetPy = targetY;
        } else {
            targetX = this.lastTargetPx + (targetX - this.lastTargetPx) * this.smoothFactor;
            targetY = this.lastTargetPy + (targetY - this.lastTargetPy) * this.smoothFactor;
            this.lastTargetPx = targetX;
            this.lastTargetPy = targetY;
        }

        const px = Math.max(0, Math.min(this.screenW - 1, Math.round(targetX)));
        const py = Math.max(0, Math.min(this.screenH - 1, Math.round(targetY)));
        return {px, py};
    }

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
                console.log("[键鼠] 鼠标移动异常:", e.message);
            }
        }, this.frameRate);
    }

    async play(evt) {
        if (!evt?.t) {
            console.log("[键鼠] 无效事件:", evt);
            return false;
        }
        try {
            switch (evt.t) {
                case "screen":
                    return true;
                case "move":
                    this.latestMousePos = {x: evt.x, y: evt.y};
                    break;
                case "down": {
                    const btn = this.mouseBtnMap[evt.b] ?? nutjs.Button.LEFT;
                    await nutjs.mouse.pressButton(btn);
                    this.pressedMouseBtn.add(btn);
                    break;
                }
                case "up": {
                    const btn = this.mouseBtnMap[evt.b] ?? nutjs.Button.LEFT;
                    await nutjs.mouse.releaseButton(btn);
                    this.pressedMouseBtn.delete(btn);
                    break;
                }
                case "wheel": {
                    const step = Math.sign(evt.dy) * Math.min(Math.abs(evt.dy / 100), 3);
                    if (step > 0) await nutjs.mouse.scrollUp(Math.abs(step));
                    if (step < 0) await nutjs.mouse.scrollDown(Math.abs(step));
                    break;
                }
                case "kd": {
                    const key = this.#convertKeyCode(evt.c);
                    if (!key) break;
                    await nutjs.keyboard.pressKey(key);
                    this.pressedKeys.add(key);
                    break;
                }
                case "ku": {
                    const key = this.#convertKeyCode(evt.c);
                    if (!key) break;
                    await nutjs.keyboard.releaseKey(key);
                    this.pressedKeys.delete(key);
                    break;
                }
                default:
                    console.log("[键鼠] 未知事件类型:", evt.t);
            }
            return true;
        } catch (err) {
            console.log("[键鼠] 执行异常:", err.message, evt);
            return false;
        }
    }

    async playBatch(eventArr, delayMs = 8) {
        if (!Array.isArray(eventArr) || eventArr.length === 0) {
            console.log("[键鼠] 回放数组为空");
            return false;
        }
        for (const item of eventArr) {
            await this.play(item);
            await new Promise(r => setTimeout(r, delayMs));
        }
        return true;
    }

    async releaseAll(rawKeyCodeList = []) {
        for (const k of this.pressedKeys) await nutjs.keyboard.releaseKey(k);
        this.pressedKeys.clear();
        for (const code of rawKeyCodeList) {
            const k = this.#convertKeyCode(code);
            if (k) await nutjs.keyboard.releaseKey(k);
        }
        for (const btn of this.pressedMouseBtn) await nutjs.mouse.releaseButton(btn);
        this.pressedMouseBtn.clear();
    }

    async destroy() {
        try {
            await this.releaseAll();
            clearInterval(this.screenTimer);
            if (this.mouseFrameInterval) {
                clearInterval(this.mouseFrameInterval);
                this.mouseFrameInterval = null;
            }
        } catch (e) {
            console.log("[键鼠] 销毁异常:", e.message);
        }
        this.latestMousePos = null;
        this.isFirstMove = true;
    }
}

let player = null;

function start() {
    if (!player) player = new MouseKeyboardPlayer();
}

async function playInput(evt) {
    if (player) await player.play(evt);
}

async function destroy() {
    if (player) {
        await player.destroy();
        player = null;
    }
}

module.exports = {
    start,
    playInput,
    destroy
}