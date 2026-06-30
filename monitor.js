class RenderInputCapture {
    constructor(options = {}) {
        this.throttleDelay = options.throttle ?? 16;
        this.wheelThrottle = options.wheelThrottle ?? 30;
        this.minMoveDelta = options.minDelta ?? 0.0008;
        // 分离节流时间戳
        this.moveLastTs = 0;
        this.wheelLastTs = 0;
        // 节流缓冲缓存：窗口内最新坐标
        this.moveBuffer = null;
        this.wheelBuffer = null;
        this.cache = { x: -999, y: -999 };
        this.handlers = new Map();
        this.timers = [];

        // 本机屏幕真实分辨率
        this.screenInfo = {
            width: screen.width,
            height: screen.height,
            dpr: window.devicePixelRatio
        };
        this.viewWidth = window.innerWidth;
        this.viewHeight = window.innerHeight;

        this.updateViewport();
        this.handleResize = () => this.updateViewport();
        window.addEventListener('resize', this.handleResize);

        this.#bindAllEvents();
        // 定时校准，消除累计偏移 200ms一次
        this.#startPositionCalibrate();
        // 初始化下发本机屏幕尺寸
        this.#sendImmediate({
            t: 'screen',
            sw: this.screenInfo.width,
            sh: this.screenInfo.height,
            dpr: this.screenInfo.dpr,
            vw: this.viewWidth,
            vh: this.viewHeight,
            ts: Date.now()
        });
    }

    updateViewport() {
        // 改用窗口可视尺寸，更适配鼠标clientX/Y
        this.viewWidth = window.innerWidth;
        this.viewHeight = window.innerHeight;
    }

    #sendImmediate(raw) {
        raw.ts = Date.now();
        rtcDcSendMessage(raw);
    }

    // 鼠标移动节流：缓冲最新点位，到期一次性发送，不丢终点
    #flushMoveBuffer() {
        if (!this.moveBuffer) return;
        this.#sendImmediate(this.moveBuffer);
        this.moveBuffer = null;
    }

    #flushWheelBuffer() {
        if (!this.wheelBuffer) return;
        this.#sendImmediate(this.wheelBuffer);
        this.wheelBuffer = null;
    }

    // 定时强制校准坐标，抹平累计偏移
    #startPositionCalibrate() {
        const timer = setInterval(() => {
            // 仅当鼠标不在静止时发送校准包
            if (this.cache.x !== -999) {
                this.#sendImmediate({
                    t: 'calibrate',
                    x: this.cache.x,
                    y: this.cache.y
                });
            }
        }, 200);
        this.timers.push(timer);
    }

    #bindAllEvents() {
        // 鼠标移动 分离节流缓冲模式
        const onMouseMove = (e) => {
            const x = e.clientX / this.viewWidth;
            const y = e.clientY / this.viewHeight;

            // 计算移动速度：时间差+位移，快速移动降低过滤门槛
            const dx = Math.abs(x - this.cache.x);
            const dy = Math.abs(y - this.cache.y);
            const moveDist = Math.sqrt(dx * dx + dy * dy);
            // 快速滑动自适应，大幅移动不拦截
            const dynamicMinDelta = moveDist > 0.003 ? 0.0001 : this.minMoveDelta;
            if (moveDist < dynamicMinDelta) return;

            this.cache.x = x;
            this.cache.y = y;
            this.moveBuffer = { t: 'move', x, y };

            const now = Date.now();
            if (now - this.moveLastTs >= this.throttleDelay) {
                this.moveLastTs = now;
                this.#flushMoveBuffer();
            }
        };
        window.addEventListener('mousemove', onMouseMove);
        this.handlers.set('mousemove', onMouseMove);

        // 鼠标按下
        const onMouseDown = (e) => {
            const x = e.clientX / this.viewWidth;
            const y = e.clientY / this.viewHeight;
            this.#sendImmediate({ t: 'down', b: e.button, x, y });
        };
        window.addEventListener('mousedown', onMouseDown);
        this.handlers.set('mousedown', onMouseDown);

        // 鼠标抬起
        const onMouseUp = (e) => {
            const x = e.clientX / this.viewWidth;
            const y = e.clientY / this.viewHeight;
            this.#sendImmediate({ t: 'up', b: e.button, x, y });
        };
        window.addEventListener('mouseup', onMouseUp);
        this.handlers.set('mouseup', onMouseUp);

        // 滚轮独立节流
        const onWheel = (e) => {
            this.wheelBuffer = { t: 'wheel', dy: e.deltaY };
            const now = Date.now();
            if (now - this.wheelLastTs >= this.wheelThrottle) {
                this.wheelLastTs = now;
                this.#flushWheelBuffer();
            }
        };
        window.addEventListener('wheel', onWheel);
        this.handlers.set('wheel', onWheel);

        // 键盘按下
        const onKeyDown = (e) => {
            if (e.repeat) return;
            this.#sendImmediate({ t: 'kd', c: e.code });
        };
        window.addEventListener('keydown', onKeyDown);
        this.handlers.set('keydown', onKeyDown);

        // 键盘抬起
        const onKeyUp = (e) => {
            this.#sendImmediate({ t: 'ku', c: e.code });
        };
        window.addEventListener('keyup', onKeyUp);
        this.handlers.set('keyup', onKeyUp);
    }

    destroy() {
        // 清空定时器
        this.timers.forEach(t => clearInterval(t));
        this.timers = [];
        // 清空缓冲
        this.moveBuffer = null;
        this.wheelBuffer = null;
        // 解绑事件
        for (const [eventName, handler] of this.handlers) {
            window.removeEventListener(eventName, handler);
        }
        this.handlers.clear();
        window.removeEventListener('resize', this.handleResize);
    }
}

// 使用示例不变
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