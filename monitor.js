class RenderInputCapture {
    constructor(options = {}) {
        this.throttleDelay = options.throttle ?? 16;
        this.minMoveDelta = options.minDelta ?? 0.0008;
        this.lastThrottleTime = 0;
        this.cache = {x: -999, y: -999};
        this.handlers = new Map();

        // 本机屏幕真实分辨率
        this.screenInfo = {
            width: screen.width,
            height: screen.height,
            dpr: window.devicePixelRatio
        };
        this.viewWidth = 0;
        this.viewHeight = 0;

        this.updateViewport();
        this.handleResize = () => this.updateViewport();
        window.addEventListener('resize', this.handleResize);

        this.#bindAllEvents();
        // 初始化下发本机屏幕尺寸
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

    #bindAllEvents() {
        // 鼠标移动 节流
        const onMouseMove = (e) => {
            const x = e.clientX / this.viewWidth;
            const y = e.clientY / this.viewHeight;
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
            const x = e.clientX / this.viewWidth;
            const y = e.clientY / this.viewHeight;
            this.#sendImmediate({t: 'down', b: e.button, x, y});
        };
        window.addEventListener('mousedown', onMouseDown);
        this.handlers.set('mousedown', onMouseDown);

        // 鼠标抬起
        const onMouseUp = (e) => {
            const x = e.clientX / this.viewWidth;
            const y = e.clientY / this.viewHeight;
            this.#sendImmediate({t: 'up', b: e.button, x, y});
        };
        window.addEventListener('mouseup', onMouseUp);
        this.handlers.set('mouseup', onMouseUp);

        // 滚轮
        const onWheel = (e) => {
            this.#sendThrottled({t: 'wheel', dy: e.deltaY});
        };
        window.addEventListener('wheel', onWheel);
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
        capture = new RenderInputCapture({throttle: 14, minDelta: 0.0008})
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