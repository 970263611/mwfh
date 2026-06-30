const robot = require("robotjs");
const os = require("os");

let win
let player

class MouseKeyboardPlayer {
    constructor() {
        // 缓存屏幕尺寸
        const screen = robot.getScreenSize();
        this.screenW = screen.width;
        this.screenH = screen.height;
        // 缓存当前按住的按键，销毁时统一释放
        this.pressedKeys = new Set();
        // 缓存按下的鼠标按键
        this.pressedMouseBtn = new Set();
        // 预定义修饰键映射，区分系统 Meta
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
    }

    // 私有：转换键盘 code 适配 robotjs，兼容 Key / Digit / 左右修饰键
    #convertKeyCode(code) {
        if (!code || typeof code !== "string") return "";

        // 匹配左右修饰键
        if (this.modifierMap.hasOwnProperty(code)) {
            return this.modifierMap[code];
        }
        // 处理字母键 KeyW -> w
        if (code.startsWith("Key")) {
            return code.slice(3).toLowerCase();
        }
        // 处理数字主键 Digit1 -> "1"
        if (code.startsWith("Digit")) {
            return code.slice(5);
        }
        // 其他按键直接小写
        return code.toLowerCase();
    }

    // 私有：归一化坐标转像素，边界限制
    #normToPixel(normX, normY) {
        let px = Math.round(normX * this.screenW);
        let py = Math.round(normY * this.screenH);
        px = Math.max(0, Math.min(this.screenW - 1, px));
        py = Math.max(0, Math.min(this.screenH - 1, py));
        return {px, py};
    }

    // 私有日志
    #log(...args) {
        const trace = {
            "time": new Date().toLocaleString('zh-CN'),
            "target": '错误',
            "msg": JSON.stringify(args),
            "type": "log-err"
        }
        win.webContents.send('trace-show', trace)
    }

    /**
     * 单条事件实时执行（流式接口，每次只传一个事件）
     * @param {Object} evt 单条键鼠事件
     * @returns {boolean} 执行成功/失败
     */
    play(evt) {
        try {
            if (!evt?.type) {
                this.#log("无效事件，缺少type字段");
                return false;
            }
            switch (evt.type) {
                case "mousemove": {
                    const {px, py} = this.#normToPixel(evt.x, evt.y);
                    robot.moveMouse(px, py);
                    break;
                }
                // 鼠标按下
                case "mousedown": {
                    // 0=左键 2=右键，robotjs 参数 left / right
                    const btn = evt.button === 2 ? "right" : "left";
                    robot.mouseToggle("down", btn);
                    this.pressedMouseBtn.add(btn);
                    break;
                }
                // 鼠标抬起
                case "mouseup": {
                    const btn = evt.button === 2 ? "right" : "left";
                    robot.mouseToggle("up", btn);
                    this.pressedMouseBtn.delete(btn);
                    break;
                }
                case "keydown": {
                    const key = this.#convertKeyCode(evt.code);
                    if (!key) break;
                    robot.keyToggle(key, "down");
                    this.pressedKeys.add(key); // 记录按下的键
                    break;
                }
                case "keyup": {
                    const key = this.#convertKeyCode(evt.code);
                    if (!key) break;
                    robot.keyToggle(key, "up");
                    this.pressedKeys.delete(key); // 移除已松开的键
                    break;
                }
                default:
                    this.#log("未知事件类型：", evt.type);
            }
            return true;
        } catch (err) {
            this.#log("执行异常：", err.message, evt);
            return false;
        }
    }

    /**
     * 批量回放兼容方法（本地录播使用，内部循环调用单条play）
     * @param {Array} eventArr 事件数组
     * @param {number} delayMs 帧间隔毫秒
     * @returns {Promise<boolean>}
     */
    async playBatch(eventArr, delayMs = 8) {
        if (!Array.isArray(eventArr) || eventArr.length === 0) {
            this.#log("事件数组为空");
            return false;
        }
        this.#log(`开始批量回放，总事件：${eventArr.length}`);
        for (const item of eventArr) {
            this.play(item);
            await new Promise(r => setTimeout(r, delayMs));
        }
        this.#log("批量回放完成");
        return true;
    }

    // 紧急抬起所有按键+松开鼠标，防止卡键/卡鼠标
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
        // 释放鼠标按键
        for (const btn of this.pressedMouseBtn) {
            robot.mouseToggle("up", btn);
        }
        this.pressedMouseBtn.clear();
    }

    /**
     * 销毁播放器实例，清理资源
     */
    destroy() {
        try {
            // 1. 全部松键、松鼠标
            this.releaseAll();
        } catch (e) {
            this.#log("销毁时释放设备异常：", e.message);
        }
        // 2. 清空缓存数据
        this.pressedKeys.clear();
        this.pressedMouseBtn.clear();
        this.screenW = null;
        this.screenH = null;
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