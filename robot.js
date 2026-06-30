@ -6,93 +6,80 @@ let player

class MouseKeyboardPlayer {
    constructor() {
        // 本机屏幕物理尺寸，移除window DPR读取（主进程无window）
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
            MetaLeft: this.metaKey, MetaRight: this.metaKey,
            ControlLeft: "control", ControlRight: "control",
            ShiftLeft: "shift", ShiftRight: "shift",
            AltLeft: "alt", AltRight: "alt"
        };

        // 鼠标按键完整映射：0左键 1中键 2右键 3侧上 4侧下
        this.mouseBtnMap = {
            0: "left",
            1: "middle",
            2: "right",
            3: "x1",
            4: "x2"
        };
        this.mouseBtnMap = { 0: "left", 1: "middle", 2: "right", 3: "x1", 4: "x2" };

        // 鼠标消息队列优化：只保留最新坐标，丢弃滞后消息，解决卡顿堆积
        this.mouseQueue = null;
        this.mouseTickLock = false;
        // 时序鼠标缓存栈（最多保留100ms内点位）
        this.mousePointStack = [];
        this.renderLock = false;

        // 平滑插值缓存
        // 平滑插值基准
        this.lastTargetPx = 0;
        this.lastTargetPy = 0;
        this.lastRenderTs = Date.now();

        // 监听屏幕分辨率变化
        this.screenChangeTimer = setInterval(() => this.#updateScreenInfo(), 1000);
        // 启动鼠标持续渲染循环
        this.#startMouseRenderLoop();
    }

    // 更新本机屏幕信息，删除window相关代码，修复ReferenceError
    #updateScreenInfo() {
        const screen = robot.getScreenSize();
        this.screenW = screen.width;
        this.screenH = screen.height;
        // 移除报错行：this.dpr = window?.devicePixelRatio || 1;
    }

    // 私有：转换键盘code适配robotjs
    #convertKeyCode(code) {
        if (!code || typeof code !== "string") return "";
        if (this.modifierMap.hasOwnProperty(code)) return this.modifierMap[code];
        if (this.modifierMap[code]) return this.modifierMap[code];
        if (code.startsWith("Key")) return code.slice(3).toLowerCase();
        if (code.startsWith("Digit")) return code.slice(5);
        return code.toLowerCase();
    }

    // 【核心修复：坐标映射算法，解决两端分辨率不一致偏移】
    // normX/normY：主控窗口归一0~1坐标
    // masterW/masterH：主控真实屏幕宽高
    #normToPixel(normX, normY) {
        // 归一坐标转本机像素 + 动态平滑
        #normToPixel(normX, normY, speedFactor = 1) {
            const { w: masterW, h: masterH } = this.masterScreen;
            // 无主控屏幕数据时降级使用简单映射（兜底）
            let targetX, targetY;

            if (masterW <= 0 || masterH <= 0) {
                return {
                    px: Math.max(0, Math.min(this.screenW - 1, Math.round(normX * this.screenW))),
                    py: Math.max(0, Math.min(this.screenH - 1, Math.round(normY * this.screenH)))
                };
                targetX = normX * this.screenW;
                targetY = normY * this.screenH;
            } else {
                const masterPx = normX * masterW;
                const masterPy = normY * masterH;
                targetX = (masterPx / masterW) * this.screenW;
                targetY = (masterPy / masterH) * this.screenH;
            }
            // 1. 换算为主控屏幕真实像素
            const masterPx = normX * masterW;
            const masterPy = normY * masterH;
            // 2. 映射到被控本机屏幕像素
            let targetX = (masterPx / masterW) * this.screenW;
            let targetY = (masterPy / masterH) * this.screenH;

            // 平滑插值，避免鼠标跳跃
            const smoothFactor = 0.35;

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

            // 边界限制
            const px = Math.max(0, Math.min(this.screenW - 1, Math.round(targetX)));
            const py = Math.max(0, Math.min(this.screenH - 1, Math.round(targetY)));
            return { px, py };
        @ -108,47 +95,95 @@ class MouseKeyboardPlayer {
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
                    // 清理超时过期点位（超过100ms直接丢弃，解决滞后堆积）
                    #pruneExpiredPoints() {
                        const now = Date.now();
                        const expireThreshold = now - 100;
                        while (this.mousePointStack.length && this.mousePointStack[0].ts < expireThreshold) {
                            this.mousePointStack.shift();
                        }
                    }

                    /**
                     * 接收WebRTC下发的单条事件
                     * @param {Object} evt 主控传来事件对象
                     */
                    // 持续渲染循环，统一调度鼠标移动，避免频繁robotjs阻塞
                    #startMouseRenderLoop() {
                        const render = () => {
                            if (this.renderLock) return requestAnimationFrame(render);
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
                                requestAnimationFrame(render);
                            }
                        }
                        requestAnimationFrame(render);
                    }

                    play(evt) {
                        if (!evt?.t) {
                            this.#log("无效事件，缺少t字段", evt);
                            return false;
                        }
                        const ts = evt.ts || Date.now();
                        try {
                            switch (evt.t) {
                                // 主控同步屏幕尺寸
                                case "screen":
                                    this.masterScreen.w = evt.sw;
                                    this.masterScreen.h = evt.sh;
                                    return true;

                                // 鼠标移动：放入队列，防抖丢弃旧帧
                                case "calibrate":
                                    // 强制校准，清空时序栈，消除累积偏移
                                    this.mousePointStack.length = 0;
                                    this.lastTargetPx = evt.x * this.masterScreen.w;
                                    this.lastTargetPy = evt.y * this.masterScreen.h;
                                    const cal = this.#normToPixel(evt.x, evt.y, 1);
                                    robot.moveMouse(cal.px, cal.py);
                                    return true;

                                case "move":
                                    this.mouseQueue = { x: evt.x, y: evt.y };
                                    setImmediate(() => this.#flushMouseMove());
                                    // 推入时序栈，渲染循环统一处理
                                    this.mousePointStack.push({
                                        x: evt.x,
                                        y: evt.y,
                                        ts
                                    });
                                    break;

                                // 鼠标按下
                                case "down": {
                                    const btnName = this.mouseBtnMap[evt.b] || "left";
                                    robot.mouseToggle("down", btnName);
                                @ -156,7 +191,6 @@ class MouseKeyboardPlayer {
                                    break;
                                }

                                    // 鼠标抬起
                                case "up": {
                                        const btnName = this.mouseBtnMap[evt.b] || "left";
                                        robot.mouseToggle("up", btnName);
                                    @ -164,12 +198,12 @@ class MouseKeyboardPlayer {
                                        break;
                                    }

                                        // 滚轮滚动
                                    case "wheel":
                                        robot.scrollMouse(0, Math.sign(evt.dy) * Math.min(Math.abs(evt.dy), 30));
                                        // 滚轮幅度限制，适配不同系统滚动手感
                                        const dy = Math.sign(evt.dy) * Math.min(Math.abs(evt.dy), 35);
                                        robot.scrollMouse(0, dy);
                                        break;

                                        // 键盘按下
                                    case "kd": {
                                            const key = this.#convertKeyCode(evt.c);
                                            if (!key) break;
                                        @ -178,7 +212,6 @@ class MouseKeyboardPlayer {
                                            break;
                                        }

                                            // 键盘抬起
                                        case "ku": {
                                                const key = this.#convertKeyCode(evt.c);
                                                if (!key) break;
                                            @ -197,9 +230,6 @@ class MouseKeyboardPlayer {
                                            }
                                            }

                                            /**
                                             * 批量回放（本地录播）
                                             */
                                            async playBatch(eventArr, delayMs = 8) {
                                                if (!Array.isArray(eventArr) || eventArr.length === 0) {
                                                    this.#log("事件数组为空");
                                                @ -212,9 +242,7 @@ class MouseKeyboardPlayer {
                                                    return true;
                                                }

                                                    // 紧急释放所有按键鼠标，防止卡死
                                                    releaseAll(rawKeyCodeList = []) {
                                                        // 释放键盘
                                                        for (const key of this.pressedKeys) {
                                                            robot.keyToggle(key, "up");
                                                        }
                                                    @ -223,7 +251,7 @@ class MouseKeyboardPlayer {
                                                        const key = this.#convertKeyCode(code);
                                                        if (key) robot.keyToggle(key, "up");
                                                    });
                                                        // 释放鼠标所有按键

                                                        for (const btn of this.pressedMouseBtn) {
                                                            robot.mouseToggle("up", btn);
                                                        }
                                                    @ -237,7 +265,7 @@ class MouseKeyboardPlayer {
                                                    } catch (e) {
                                                            this.#log("销毁释放资源异常：", e.message);
                                                        }
                                                        this.mouseQueue = null;
                                                        this.mousePointStack.length = 0;
                                                        this.pressedKeys.clear();
                                                        this.pressedMouseBtn.clear();
                                                        this.screenW = 0;
                                                    @ -246,7 +274,6 @@ class MouseKeyboardPlayer {
                                                    }
                                                    }

// 对外接口不变，上层无需修改调用代码
                                                    function start(mainWin) {
                                                        win = mainWin
                                                        player = new MouseKeyboardPlayer()
