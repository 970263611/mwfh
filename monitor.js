class RenderInputCapture {
    constructor(options = {}) {
        // 优化1：调整默认节流和最小位移，减少无效发包
        this.throttleDelay = options.throttle ?? 16; // 60fps
        this.minMoveDelta = options.minDelta ?? 0.002; // 1080P下约2像素，过滤微抖动
        this.lastThrottleTime = 0;
        this.cache = {x: -999, y: -999};
        this.handlers = new Map();

        // 本机屏幕信息（仅用于状态上报，不再参与坐标换算）
        this.screenInfo = {
            width: screen.width,
            height: screen.height,
            dpr: window.devicePixelRatio
        };

        // 视口尺寸 + 远程画面实际显示区域（等比例适配用）
        this.viewWidth = 0;
        this.viewHeight = 0;
        this.displayArea = {offsetX: 0, offsetY: 0, width: 0, height: 0};

        // 被控端屏幕比例（由被控端回传，或初始化时传入；如果是拉伸铺满可忽略）
        this.targetAspect = options.targetAspect ?? (16 / 9);

        this.updateViewport();
        this.handleResize = () => this.updateViewport();
        window.addEventListener('resize', this.handleResize);
        this.#bindAllEvents();

        // 初始化下发本机屏幕尺寸（仅作统计，不参与坐标计算）
        this.#sendImmediate({
            t: 'screen',
            sw: this.screenInfo.width,
            sh: this.screenInfo.height
        });
    }

    updateViewport() {
        const rect = document.documentElement.getBoundingClientRect();
        this.viewWidth = rect.width;
        this.viewHeight = rect.height;

        // 优化2：计算远程画面等比例居中后的真实显示区域（修复黑边导致的坐标偏移）
        // 如果你的画面是强制拉伸铺满，可删除这部分计算
        const viewAspect = this.viewWidth / this.viewHeight;
        if (viewAspect > this.targetAspect) {
            // 视口更宽，左右有黑边
            this.displayArea.height = this.viewHeight;
            this.displayArea.width = this.viewHeight * this.targetAspect;
            this.displayArea.offsetX = (this.viewWidth - this.displayArea.width) / 2;
            this.displayArea.offsetY = 0;
        } else {
            // 视口更高，上下有黑边
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

    // 优化3：统一坐标换算函数，基于真实显示区域计算归一化坐标
    #getNormalizedPos(e) {
        const x = (e.clientX - this.displayArea.offsetX) / this.displayArea.width;
        const y = (e.clientY - this.displayArea.offsetY) / this.displayArea.height;
        // 边界限制，黑边区域不触发
        return {
            x: Math.max(0, Math.min(1, x)),
            y: Math.max(0, Math.min(1, y))
        };
    }

    #bindAllEvents() {
        // 鼠标移动 节流
        const onMouseMove = (e) => {
            const {x, y} = this.#getNormalizedPos(e);
            if (Math.abs(x - this.cache.x) < this.minMoveDelta && Math.abs(y - this.cache.y) < this.minMoveDelta) return;
            this.cache.x = x;
            this.cache.y = y;
            this.#sendThrottled({
                t: 'move',
                x,
                y
            });
        };
        window.addEventListener('mousemove', onMouseMove);
        this.handlers.set('mousemove', onMouseMove);

        // 鼠标按下
        const onMouseDown = (e) => {
            const {x, y} = this.#getNormalizedPos(e);
            this.#sendImmediate({t: 'down', b: e.button, x, y});
        };
        window.addEventListener('mousedown', onMouseDown);
        this.handlers.set('mousedown', onMouseDown);

        // 鼠标抬起
        const onMouseUp = (e) => {
            const {x, y} = this.#getNormalizedPos(e);
            this.#sendImmediate({t: 'up', b: e.button, x, y});
        };
        window.addEventListener('mouseup', onMouseUp);
        this.handlers.set('mouseup', onMouseUp);

        // 滚轮（单独节流，滚动事件触发频率极高）
        const onWheel = (e) => {
            e.preventDefault();
            this.#sendThrottled({t: 'wheel', dy: e.deltaY});
        };
        window.addEventListener('wheel', onWheel, {passive: false});
        this.handlers.set('wheel', onWheel);

        // 键盘按下
        const onKeyDown = (e) => {
            if (e.repeat) return;
            this.#sendImmediate({t: 'kd', c: e.code});
        };
        window.addEventListener('keydown', onKeyDown);
        this.handlers.set('keydown', onKeyDown);

        // 键盘抬起
        const onKeyUp = (e) => {
            this.#sendImmediate({t: 'ku', c: e.code});
        };
        window.addEventListener('keyup', onKeyUp);
        this.handlers.set('keyup', onKeyUp);
    }

    destroy() {
        for (const [eventName, handler] of this.handlers) {
            window.removeEventListener(eventName, handler);
        }
        this.handlers.clear();
        window.removeEventListener('resize', this.handleResize);
    }
}

// 使用示例
let capture

function monitorStart() {
    if (!capture) {
        // 初始化时传入被控端屏幕比例，例如 1920x1080 就是 16/9
        capture = new RenderInputCapture({throttle: 16, minDelta: 0.002, targetAspect: 16 / 9})
        pushLog("系统", `打开键鼠监听`, "log-succ");
    }
}

function monitorDestroy() {
    if (capture) {
        capture.destroy()
        capture = null
        pushLog("系统", `已关闭键鼠监听`, "log-succ");
    }
}