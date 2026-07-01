// 发起方 PeerConnection 和 DataChannel
let pc, dc;
// 应答方 PeerConnection 和 DataChannel
let pc_, dc_;

/**
 * 等待 ICE 候选收集完成
 * 超时 5 秒后返回已收集的候选
 * @param {RTCPeerConnection} pc
 * @returns {Promise<{sdp: RTCSessionDescription, candidates: RTCIceCandidate[]}>}
 */
function waitAllIceComplete(pc) {
    return new Promise((resolve) => {
        const allCandidates = [];
        // 5 秒超时兜底
        const timer = setTimeout(() => {
            pushLog('系统', 'ICE收集超时，返回当前已收集候选', 'log-warn');
            resolve({sdp: pc.localDescription, candidates: allCandidates});
        }, 5000);

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                allCandidates.push(e.candidate);
            } else {
                // 收集完成
                clearTimeout(timer);
                resolve({sdp: pc.localDescription, candidates: allCandidates});
            }
        };
    });
}

// ========== 发起方（主控端，观看对方屏幕） ==========

/**
 * 发起 RTC 连接（发起方）
 * @param {object} node - 对方节点信息
 * @param {HTMLVideoElement} videoDom - 视频播放元素
 */
async function startRtc(node, videoDom) {
    // RTC 配置：使用 Google 的 STUN 服务器
    const rtcConfig = {
        iceServers: [{urls: 'stun:stun.l.google.com:19302'}],
        iceTransportPolicy: 'all'
    };
    pc = new RTCPeerConnection(rtcConfig);

    // 监听连接状态变化，断开时执行清理
    pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        if (state === 'disconnected' || state === 'failed' || state === 'closed') {
            disconnectWatch();
        }
    };

    // 创建数据通道：用于传输键鼠事件
    // maxRetransmits=3 最多重传 3 次，ordered=false 不保证顺序（实时性优先）
    dc = pc.createDataChannel('mwfh', {
        maxRetransmits: 3,
        ordered: false
    });
    dc.onopen = () => pushLog('系统', 'RTC数据通道建立成功', 'log-succ');
    dc.onmessage = (ev) => pushLog('系统', 'RTC数据通道接收消息：' + ev.data, 'log-succ');
    dc.onerror = (err) => pushLog('系统', 'RTC数据通道异常：' + err.message, 'log-err');

    // 手动创建视频收发器，声明只接收视频（发起方不发送自己的画面）
    pc.addTransceiver('video', {direction: 'recvonly'});

    // 接收远端视频轨道
    const remoteStream = new MediaStream();
    pc.ontrack = (e) => {
        pushLog('系统', '收到远端轨道' + e.track.kind, 'log-succ');
        remoteStream.addTrack(e.track);
        videoDom.srcObject = remoteStream;
        videoDom.play().catch(err => pushLog('系统', 'RTC播放异常：' + err.message, 'log-err'));
    };

    // 创建 offer 并收集 ICE
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const signalData = await waitAllIceComplete(pc);
    // 通过 HTTP 信令发送 offer 给对方
    window.ea.viewOtherNode(node, JSON.stringify(signalData));
}

/**
 * 发起方接收对方的 answer
 * @param {object} screen - 对方屏幕尺寸 {width, height}
 * @param {object} param1 - {sdp, candidates}
 */
async function handleRemoteAnswer(screen, {sdp, candidates}) {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    // 添加对方的 ICE 候选
    for (const cand of candidates) {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
    }
    // 连接成功，最大化窗口
    window.ea.maximize();
    // 保存远端屏幕尺寸
    setRemoteScreen(screen);
    // 更新键鼠监听的坐标映射基准
    if (typeof updateRemoteDisplay === 'function') {
        updateRemoteDisplay(screen.width, screen.height);
    }
}

// ========== 应答方（被控端，被对方观看） ==========

/**
 * 应答方处理收到的 offer
 * @param {string} name - 对方节点名称
 * @param {string} addr - 对方地址
 * @param {string} secret - 对方密钥
 * @param {object} param3 - {sdp, candidates}
 */
async function handleRemoteOffer(name, addr, secret, {sdp, candidates}) {
    const rtcConfig = {
        iceServers: [{urls: 'stun:stun.l.google.com:19302'}],
        iceTransportPolicy: 'all'
    };
    pc_ = new RTCPeerConnection(rtcConfig);

    // 监听连接状态变化，断开时执行清理
    pc_.oniceconnectionstatechange = () => {
        const state = pc_.iceConnectionState;
        if (state === 'disconnected' || state === 'failed' || state === 'closed') {
            disconnectControlled();
        }
    };

    // 监听数据通道（对方创建的通道）
    pc_.ondatachannel = (e) => {
        dc_ = e.channel;
        // 收到键鼠事件时转发给主进程执行
        dc_.onmessage = (ev) => window.ea.monitorInput(ev.data);
    };

    // 1. 载入对方的 offer 和 ICE 候选
    await pc_.setRemoteDescription(new RTCSessionDescription(sdp));
    for (const cand of candidates) {
        await pc_.addIceCandidate(new RTCIceCandidate(cand));
    }

    // 2. 获取屏幕共享流并添加到 PeerConnection
    let localStream;
    try {
        localStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: "never",
                frameRate: {ideal: 60}
            },
            audio: false
        });
        for (const track of localStream.getTracks()) {
            pc_.addTrack(track, localStream);
        }
    } catch (err) {
        pushLog('错误', err.message, 'log-err');
        return;
    }

    // 3. 创建 answer 并收集 ICE
    const answer = await pc_.createAnswer();
    await pc_.setLocalDescription(answer);
    const signalData = await waitAllIceComplete(pc_);

    // 通过 HTTP 信令发送 answer 给对方
    window.ea.callbackViewNode({name, addr, secret}, JSON.stringify(signalData));

    // 进入被控模式 UI
    enterControlledMode(name);
    // 最小化窗口（被控端不需要看界面）
    window.ea.minimize();
}

/** 发起方关闭连接 */
function rtcPcClose() {
    peerClose(pc).then(() => window.ea.unmaximize());
}

/** 应答方关闭连接 */
async function rtcPc_Close() {
    peerClose(pc_).then(() => window.ea.restore());
}

/**
 * 分层异步关闭 PeerConnection，避免 DtlsTransport 报错
 * 顺序：关数据通道 → 停媒体轨道 → 关连接
 * @param {RTCPeerConnection|null} peer
 */
async function peerClose(peer) {
    if (!peer) return;

    try {
        // 关闭所有数据通道
        const dcList = peer.dataChannels ? [...peer.dataChannels] : [];
        for (const dc of dcList) {
            try {
                if (dc.readyState !== 'closed') dc.close();
            } catch (e) {
            }
        }

        // 停止发送轨道（屏幕共享等）
        peer.getSenders().forEach(sender => {
            try {
                if (sender.track) sender.track.stop();
                sender.replaceTrack(null);
            } catch (e) {
            }
        });

        // 停止接收轨道
        peer.getReceivers().forEach(receiver => {
            try {
                if (receiver.track) receiver.track.stop();
            } catch (e) {
            }
        });

        // 最后关闭连接
        peer.close();
    } catch (err) {
        pushLog('系统', `RTC关闭异常: ${err.message}`, 'log-err');
    }
}

// ========== 数据通道发送封装 ==========

/** 发起方通过数据通道发送消息 */
function rtcDcSendMessage(data) {
    sendMessage(dc, data);
}

/** 应答方通过数据通道发送消息 */
function rtcDc_SendMessage(data) {
    sendMessage(dc_, data);
}

/**
 * 通用数据通道发送
 * @param {RTCDataChannel} channel
 * @param {string|object} data
 */
function sendMessage(channel, data) {
    // 必须是 open 状态才能发送
    if (channel && channel.readyState === 'open') {
        try {
            // 对象自动转 JSON 字符串
            const msg = typeof data === 'string' ? data : JSON.stringify(data);
            channel.send(msg);
        } catch (err) {
            pushLog('系统', '发送DC消息异常：' + err.message, 'log-err');
        }
    }
}
