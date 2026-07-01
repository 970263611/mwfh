/**
 * 渲染进程键鼠事件采集器（主控端）
 * 监听 video 元素上的键鼠事件，归一化后通过 RTC 数据通道发送给被控端
 */
class RenderInputCapture {
    constructor(options = {}) {
        // 节流和最小移动距离配置
        this.throttleDelay = options.throttle ?? 16;    // 节流间隔，默认 16ms（约 60fps）
        this.minMoveDelta = options.minDelta ?? 0.002;   // 最小移动距离（归一化），小于则忽略
        this.lastThrottleTime = 0;                       // 上次发送时间
        this.cache = {x: -999, y: -999};                 // 上次发送的坐标缓存
        this.handlers = new Map();                       // 事件处理器映射，用于销毁时清理

        // 远程预览 video DOM（必传）
        this.videoEl = options.videoEl;
        if (!this.videoEl) throw new Error('必须传入远程预览video DOM元素');

        // 视口尺寸和画面居中显示区域（扣除黑边）
        this.viewWidth = 0;
        this.viewHeight = 0;
        this.displayArea = {offsetX: 0, offsetY: 0, width: 0, height: 0};

        // 被控端屏幕分辨率（默认 1080p，收到 answer 后更新）
        this.remoteScreen = {
            width: options.remoteW ?? 1920,
            height: options.remoteH ?? 1080
        };
        this.targetAspect = this.remoteScreen.width / this.remoteScreen.height;

        // 初始化
        this.updateViewport();
        this.handleResize = () => this.updateViewport();
        window.addEventListener('resize', this.handleResize);
        this.#bindAllEvents();
    }

    /**
     * 更新被控端屏幕分辨率（收到 answer 后调用）
     * @param {number} w - 宽度
     * @param {number} h - 高度
     */
    updateRemoteScreen(w, h) {
        this.remoteScreen.width = w;
        this.remoteScreen.height = h;
        this.targetAspect = w / h;
        this.updateViewport();
    }

    /** 更新视口和显示区域，计算等比例居中后的黑边偏移 */
    updateViewport() {
        const rect = this.videoEl.getBoundingClientRect();
        this.viewWidth = rect.width;
        this.viewHeight = rect.height;

        const viewAspect = this.viewWidth / this.viewHeight;
        if (viewAspect > this.targetAspect) {
            // 容器更宽，左右有黑边
            this.displayArea.height = this.viewHeight;
            this.displayArea.width = this.viewHeight * this.targetAspect;
            this.displayArea.offsetX = (this.viewWidth - this.displayArea.width) / 2;
            this.displayArea.offsetY = 0;
        } else {
            // 容器更高，上下有黑边
            this.displayArea.width = this.viewWidth;
            this.displayArea.height = this.viewWidth / this.targetAspect;
            this.displayArea.offsetX = 0;
            this.displayArea.offsetY = (this.viewHeight - this.displayArea.height) / 2;
        }
    }

    /** 立即发送（不节流，用于按下/抬起等关键事件） */
    #sendImmediate(raw) {
        rtcDcSendMessage(raw);
    }

    /** 节流发送（用于移动、滚轮等高频事件） */
    #sendThrottled(raw) {
        const now = Date.now();
        if (now - this.lastThrottleTime < this.throttleDelay) return;
        this.lastThrottleTime = now;
        rtcDcSendMessage(raw);
    }

    /**
     * 鼠标坐标归一化（0~1），扣除黑边区域
     * @param {MouseEvent} e
     * @returns {{x: number, y: number}}
     */
    #getNormalizedPos(e) {
        const rect = this.videoEl.getBoundingClientRect();
        // 相对视频有效画面的坐标（减去容器左上角和黑边偏移）
        const relX = e.clientX - rect.left - this.displayArea.offsetX;
        const relY = e.clientY - rect.top - this.displayArea.offsetY;

        let x = relX / this.displayArea.width;
        let y = relY / this.displayArea.height;

        // 限制在 0~1 范围内，黑边区域不产生坐标
        x = Math.max(0, Math.min(1, x));
        y = Math.max(0, Math.min(1, y));
        return {x, y};
    }

    /**
     * 生成修饰键掩码
     * ctrl=1, shift=2, alt=4, meta(win/cmd)=8
     * @param {KeyboardEvent} e
     * @returns {number}
     */
    #getModMask(e) {
        let mask = 0;
        if (e.ctrlKey) mask |= 1;
        if (e.shiftKey) mask |= 2;
        if (e.altKey) mask |= 4;
        if (e.metaKey) mask |= 8;
        return mask;
    }

    /** 绑定所有键鼠事件监听 */
    #bindAllEvents() {
        // 鼠标移动（节流发送）
        const onMouseMove = (e) => {
            const {x, y} = this.#getNormalizedPos(e);
            // 移动距离太小则忽略，减少无效数据
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

        // 鼠标按下（立即发送）
        const onMouseDown = (e) => {
            const {x, y} = this.#getNormalizedPos(e);
            // 点击时自动聚焦 video，确保键盘事件能触发
            this.videoEl.focus();
            this.#sendImmediate({t: 'down', b: e.button, x, y});
        };
        this.videoEl.addEventListener('mousedown', onMouseDown);
        this.handlers.set('mousedown', onMouseDown);

        // 鼠标抬起（立即发送）
        const onMouseUp = (e) => {
            const {x, y} = this.#getNormalizedPos(e);
            this.#sendImmediate({t: 'up', b: e.button, x, y});
        };
        this.videoEl.addEventListener('mouseup', onMouseUp);
        this.handlers.set('mouseup', onMouseUp);

        // 鼠标滚轮（节流发送）
        const onWheel = (e) => {
            e.preventDefault();
            this.#sendThrottled({t: 'wheel', dy: e.deltaY});
        };
        this.videoEl.addEventListener('wheel', onWheel, {passive: false});
        this.handlers.set('wheel', onWheel);

        // 键盘按下（立即发送，忽略重复按键）
        const onKeyDown = (e) => {
            if (e.repeat) return;
            const mod = this.#getModMask(e);
            this.#sendImmediate({t: 'kd', c: e.code, mod});
        };
        this.videoEl.addEventListener('keydown', onKeyDown);
        this.handlers.set('keydown', onKeyDown);

        // 键盘抬起（立即发送）
        const onKeyUp = (e) => {
            const mod = this.#getModMask(e);
            this.#sendImmediate({t: 'ku', c: e.code, mod});
        };
        this.videoEl.addEventListener('keyup', onKeyUp);
        this.handlers.set('keyup', onKeyUp);
    }

    /** 销毁采集器，移除所有事件监听 */
    destroy() {
        for (const [eventName, handler] of this.handlers) {
            this.videoEl.removeEventListener(eventName, handler);
        }
        this.handlers.clear();
        window.removeEventListener('resize', this.handleResize);
    }
}

// 全局单例
let capture = null;

/**
 * 启动键鼠采集（单例）
 * @param {HTMLVideoElement} videoDom - 预览视频元素
 * @param {number} remoteW - 被控端初始宽度
 * @param {number} remoteH - 被控端初始高度
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
        pushLog('系统', '打开键鼠监听', 'log-succ');
    }
}

/**
 * 更新被控端屏幕分辨率
 * @param {number} w - 宽度
 * @param {number} h - 高度
 */
function updateRemoteDisplay(w, h) {
    if (capture) capture.updateRemoteScreen(w, h);
}

/** 关闭键鼠采集 */
function monitorDestroy() {
    if (capture) {
        capture.destroy();
        capture = null;
        pushLog('系统', '已关闭键鼠监听', 'log-succ');
    }
}
