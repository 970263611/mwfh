class RenderInputCapture {
    constructor(options = {}) {
        // 节流、抖动过滤配置
        this.throttleDelay = options.throttle ?? 16;
        this.minMoveDelta = options.minDelta ?? 0.002;
        this.lastThrottleTime = 0;
        this.cache = { x: -999, y: -999 };
        this.handlers = new Map();

        // 远程预览 video DOM（必传，替代canvas）
        this.videoEl = options.videoEl;
        if (!this.videoEl) throw new Error("必须传入远程预览video DOM元素");

        // 视口尺寸、画面居中黑边区域
        this.viewWidth = 0;
        this.viewHeight = 0;
        this.displayArea = { offsetX: 0, offsetY: 0, width: 0, height: 0 };

        // 被控端屏幕分辨率（由被控端推送更新，对齐BilldDesk逻辑）
        this.remoteScreen = {
            width: options.remoteW ?? 1920,
            height: options.remoteH ?? 1080
        };
        this.targetAspect = this.remoteScreen.width / this.remoteScreen.height;

        this.updateViewport();
        this.handleResize = () => this.updateViewport();
        window.addEventListener('resize', this.handleResize);
        this.#bindAllEvents();
    }

    /**
     * 外部接口：被控端推送屏幕分辨率时调用，更新画面比例
     * @param {number} w 被控桌面宽
     * @param {number} h 被控桌面高
     */
    updateRemoteScreen(w, h) {
        this.remoteScreen.width = w;
        this.remoteScreen.height = h;
        this.targetAspect = w / h;
        this.updateViewport();
    }

    /**
     * 更新video容器尺寸，计算等比例居中黑边区域（BilldDesk同源逻辑）
     */
    updateViewport() {
        const rect = this.videoEl.getBoundingClientRect();
        this.viewWidth = rect.width;
        this.viewHeight = rect.height;

        const viewAspect = this.viewWidth / this.viewHeight;
        if (viewAspect > this.targetAspect) {
            // 容器更宽，左右黑边
            this.displayArea.height = this.viewHeight;
            this.displayArea.width = this.viewHeight * this.targetAspect;
            this.displayArea.offsetX = (this.viewWidth - this.displayArea.width) / 2;
            this.displayArea.offsetY = 0;
        } else {
            // 容器更高，上下黑边
            this.displayArea.width = this.viewWidth;
            this.displayArea.height = this.viewWidth / this.targetAspect;
            this.displayArea.offsetX = 0;
            this.displayArea.offsetY = (this.viewHeight - this.displayArea.height) / 2;
        }
    }

    #sendImmediate(raw) {
        rtcDcSendMessage(raw);
    }

    #sendThrottled(raw) {
        const now = Date.now();
        if (now - this.lastThrottleTime < this.throttleDelay) return;
        this.lastThrottleTime = now;
        rtcDcSendMessage(raw);
    }

    /**
     * 鼠标坐标归一化 0~1，剔除黑边区域
     * @param {MouseEvent} e
     * @returns {{x: number, y: number}}
     */
    #getNormalizedPos(e) {
        const rect = this.videoEl.getBoundingClientRect();
        // 鼠标坐标 - video容器左上角 - 黑边偏移
        const relX = e.clientX - rect.left - this.displayArea.offsetX;
        const relY = e.clientY - rect.top - this.displayArea.offsetY;

        let x = relX / this.displayArea.width;
        let y = relY / this.displayArea.height;

        // 限制在有效画面内，黑边不产生坐标
        x = Math.max(0, Math.min(1, x));
        y = Math.max(0, Math.min(1, y));
        return { x, y };
    }

    /**
     * 生成修饰键掩码，和BilldDesk规则一致
     * ctrl=1 shift=2 alt=4 meta(win/cmd)=8
     */
    #getModMask(e) {
        let mask = 0;
        if (e.ctrlKey) mask |= 1;
        if (e.shiftKey) mask |= 2;
        if (e.altKey) mask |= 4;
        if (e.metaKey) mask |= 8;
        return mask;
    }

    #bindAllEvents() {
        // 鼠标移动 - 仅video内触发
        const onMouseMove = (e) => {
            const { x, y } = this.#getNormalizedPos(e);
            if (Math.abs(x - this.cache.x) < this.minMoveDelta && Math.abs(y - this.cache.y) < this.minMoveDelta) return;
            this.cache.x = x;
            this.cache.y = y;
            this.#sendThrottled({
                t: 'move',
                x,
                y,
                ts: Date.now()
            });
        };
        this.videoEl.addEventListener('mousemove', onMouseMove);
        this.handlers.set('mousemove', onMouseMove);

        // 鼠标按下
        const onMouseDown = (e) => {
            const { x, y } = this.#getNormalizedPos(e);
            this.#sendImmediate({ t: 'down', b: e.button, x, y });
        };
        this.videoEl.addEventListener('mousedown', onMouseDown);
        this.handlers.set('mousedown', onMouseDown);

        // 鼠标抬起
        const onMouseUp = (e) => {
            const { x, y } = this.#getNormalizedPos(e);
            this.#sendImmediate({ t: 'up', b: e.button, x, y });
        };
        this.videoEl.addEventListener('mouseup', onMouseUp);
        this.handlers.set('mouseup', onMouseUp);

        // 鼠标滚轮
        const onWheel = (e) => {
            e.preventDefault();
            this.#sendThrottled({ t: 'wheel', dy: e.deltaY });
        };
        this.videoEl.addEventListener('wheel', onWheel, { passive: false });
        this.handlers.set('wheel', onWheel);

        // 键盘按下（video需要加tabindex才能捕获键盘）
        const onKeyDown = (e) => {
            if (e.repeat) return;
            const mod = this.#getModMask(e);
            this.#sendImmediate({ t: 'kd', c: e.code, mod });
        };
        this.videoEl.addEventListener('keydown', onKeyDown);
        this.handlers.set('keydown', onKeyDown);

        // 键盘抬起
        const onKeyUp = (e) => {
            const mod = this.#getModMask(e);
            this.#sendImmediate({ t: 'ku', c: e.code, mod });
        };
        this.videoEl.addEventListener('keyup', onKeyUp);
        this.handlers.set('keyup', onKeyUp);
    }

    /**
     * 销毁监听，释放事件
     */
    destroy() {
        for (const [eventName, handler] of this.handlers) {
            this.videoEl.removeEventListener(eventName, handler);
        }
        this.handlers.clear();
        window.removeEventListener('resize', this.handleResize);
    }
}

// 全局实例管理
let capture = null;

/**
 * 启动键鼠采集
 * @param {HTMLVideoElement} videoDom 你的预览video标签DOM
 * @param {number} remoteW 初始被控宽
 * @param {number} remoteH 初始被控高
 */
function monitorStart(videoDom, remoteW = 1920, remoteH = 1080) {
    if (!capture) {
        capture = new RenderInputCapture({
            videoEl: videoDom,
            remoteW,
            remoteH,
            throttle: 16,
            minDelta: 0.002
        });
        pushLog("系统", `打开键鼠监听`, "log-succ");
    }
}

/**
 * 被控端传回屏幕分辨率，更新画面比例
 */
function updateRemoteDisplay(w, h) {
    if (capture) capture.updateRemoteScreen(w, h);
}

/**
 * 关闭采集
 */
function monitorDestroy() {
    if (capture) {
        capture.destroy();
        capture = null;
        pushLog("系统", `已关闭键鼠监听`, "log-succ");
    }
}