class RenderInputCapture {
    constructor(options = {}) {
        // 高频事件节流间隔（仅mousemove、wheel生效）
        this.throttleDelay = options.throttle ?? 16;
        this.lastThrottleTime = 0;

        // 坐标缓存，过滤微小位移
        this.cache = {x: -999, y: -999};
        // 事件处理器引用，用于销毁
        this.handlers = new Map();

        // 缓存窗口尺寸，resize时更新，避免高频DOM查询
        this.updateViewport();
        this.handleResize = () => this.updateViewport();
        window.addEventListener('resize', this.handleResize);

        this.#bindAllEvents();
    }

    // 更新视口尺寸
    updateViewport() {
        const rect = document.documentElement.getBoundingClientRect();
        this.viewWidth = rect.width;
        this.viewHeight = rect.height;
    }

    // 实时事件立即发送（点击、按键），不节流
    #sendImmediate(payload) {
        rtcDcSendMessage(payload)
    }

    // 高频事件节流发送（鼠标移动、滚轮）
    #sendThrottled(payload) {
        const now = Date.now();
        if (now - this.lastThrottleTime < this.throttleDelay) return;
        this.lastThrottleTime = now;
        rtcDcSendMessage(payload)
    }

    // 绑定所有键鼠事件
    #bindAllEvents() {
        // 鼠标移动 - 节流
        const onMouseMove = (e) => {
            const x = e.clientX / this.viewWidth;
            const y = e.clientY / this.viewHeight;
            // 极小位移过滤，减少无效发包
            if (Math.abs(x - this.cache.x) < 0.0003 && Math.abs(y - this.cache.y) < 0.0003) return;
            this.cache.x = x;
            this.cache.y = y;
            this.#sendThrottled({type: 'mousemove', x, y});
        };
        window.addEventListener('mousemove', onMouseMove);
        this.handlers.set('mousemove', onMouseMove);

        // 鼠标按下 - 实时
        const onMouseDown = (e) => {
            const x = e.clientX / this.viewWidth;
            const y = e.clientY / this.viewHeight;
            this.#sendImmediate({type: 'mousedown', btn: e.button, x, y});
        };
        window.addEventListener('mousedown', onMouseDown);
        this.handlers.set('mousedown', onMouseDown);

        // 鼠标抬起 - 实时
        const onMouseUp = (e) => {
            const x = e.clientX / this.viewWidth;
            const y = e.clientY / this.viewHeight;
            this.#sendImmediate({type: 'mouseup', btn: e.button, x, y});
        };
        window.addEventListener('mouseup', onMouseUp);
        this.handlers.set('mouseup', onMouseUp);

        // 滚轮 - 节流
        const onWheel = (e) => {
            e.preventDefault();
            this.#sendThrottled({type: 'wheel', deltaY: e.deltaY});
        };
        window.addEventListener('wheel', onWheel, {passive: false});
        this.handlers.set('wheel', onWheel);

        // 键盘按下 - 实时，过滤长按重复
        const onKeyDown = (e) => {
            if (e.repeat) return;
            this.#sendImmediate({type: 'keydown', code: e.code});
        };
        window.addEventListener('keydown', onKeyDown);
        this.handlers.set('keydown', onKeyDown);

        // 键盘抬起 - 实时
        const onKeyUp = (e) => {
            this.#sendImmediate({type: 'keyup', code: e.code});
        };
        window.addEventListener('keyup', onKeyUp);
        this.handlers.set('keyup', onKeyUp);
    }

    // 完整销毁，无内存泄漏
    destroy() {
        // 移除所有DOM事件
        for (const [eventName, handler] of this.handlers) {
            window.removeEventListener(eventName, handler);
        }
        this.handlers.clear();

        // 移除额外监听
        window.removeEventListener('resize', this.handleResize);
    }
}

// ========== 使用示例 ==========
// 实例化捕获器，窗口内操作会同步控制系统键鼠
let capture

function monitorStart() {
    capture = new RenderInputCapture({throttle: 16})
    pushLog("系统", `打开键鼠监听`, "log-succ");
}

function monitorDestroy() {
    if (capture) {
        capture.destroy()
        capture = null
        pushLog("系统", `已关闭键鼠监听`, "log-succ");
    }
}

