let pc
let dc
let pc_
let dc_

// 收集全部ICE候选
function waitAllIceComplete(pc) {
    return new Promise((resolve) => {
        const allCandidates = [];
        const timer = setTimeout(() => {
            pushLog('系统', 'ICE收集超时，返回当前已收集候选', 'log-warn')
            resolve({sdp: pc.localDescription, candidates: allCandidates});
        }, 5000);

        pc.onicecandidate = (e) => {
            if (e.candidate) {
                allCandidates.push(e.candidate);
            } else {
                clearTimeout(timer);
                resolve({sdp: pc.localDescription, candidates: allCandidates});
            }
        };
    });
}

// ========== 发起方（只接收对方屏幕，不发送本地流） ==========
async function startRtc(node, videoDom) {
    const rtcConfig = {
        iceServers: [{urls: "stun:stun.l.google.com:19302"}],
        iceTransportPolicy: "all"
    };
    pc = new RTCPeerConnection(rtcConfig);

    pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        // 对方断开、网络失败、连接关闭
        if (state === 'disconnected' || state === 'failed' || state === 'closed') {
            disconnectWatch(); // 执行断开逻辑：清视频、关闭遮罩、销毁peer
        } else {
            // 数据通道
            // dc = pc.createDataChannel("mwfh");
            // dc.onopen = () => {
            //     pushLog('系统', '纯WebRTC数据通道建立成功', 'log-succ')
            // }
            // dc.onmessage = (ev) => console.log("收到DC消息:", ev.data)
            // dc.onerror = (err) => {
            //     pushLog('系统', 'RTC数据通道异常：' + err.message, 'log-err')
            // }
        }
    };

    // ========== 核心修复：手动创建视频收发器，声明要接收视频 ==========
    pc.addTransceiver('video', {direction: 'recvonly'});

    // 接收远端视频轨道
    const remoteStream = new MediaStream();
    pc.ontrack = (e) => {
        pushLog('系统', '收到远端轨道' + e.track.kind, 'log-succ')
        remoteStream.addTrack(e.track);
        videoDom.srcObject = remoteStream;
        videoDom.play().catch(err => {
            pushLog('系统', 'RTC播放异常：' + err.message, 'log-err')
        });
    };

    // 发起方不添加任何本地媒体轨道
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const signalData = await waitAllIceComplete(pc);
    window.ea.viewOtherNode(node, JSON.stringify(signalData));
}

// 发起方接收远端Answer
async function handleRemoteAnswer({sdp, candidates}) {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    for (const cand of candidates) {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
    }
    window.ea.maximize()
}

// ========== 应答方（收到Offer，采集本机屏幕发给发起方） ==========
async function handleRemoteOffer(name, addr, secret, {sdp, candidates}) {
    const rtcConfig = {
        iceServers: [{urls: "stun:stun.l.google.com:19302"}],
        iceTransportPolicy: "all"
    };
    pc_ = new RTCPeerConnection(rtcConfig);

    pc_.oniceconnectionstatechange = () => {
        const state = pc_.iceConnectionState;
        // 对方断开、网络失败、连接关闭
        if (state === 'disconnected' || state === 'failed' || state === 'closed') {
            disconnectControlled(); // 执行断开逻辑：清视频、关闭遮罩、销毁peer
        }
    };

    // pc_.ondatachannel = (e) => {
    //     dc_ = e.channel;
    //     dc_.onmessage = (ev) => console.log("应答方DC收到消息：", ev.data);
    // };

    // 1. 载入对方Offer与ICE候选
    await pc_.setRemoteDescription(new RTCSessionDescription(sdp));
    for (const cand of candidates) {
        await pc_.addIceCandidate(new RTCIceCandidate(cand));
    }

    // 2. 获取屏幕流并添加
    let localStream;
    try {
        localStream = await navigator.mediaDevices.getDisplayMedia({
            video: {frameRate: {ideal: 60, cursor: 'never'}}
        });
        for (const track of localStream.getTracks()) {
            pc_.addTrack(track, localStream);
        }
    } catch (err) {
        pushLog("错误", err.message, "log-err");
        return;
    }

    // 3. 生成Answer
    const answer = await pc_.createAnswer();
    await pc_.setLocalDescription(answer);
    const signalData = await waitAllIceComplete(pc_);

    window.ea.callbackViewNode({
        name: name,
        addr: addr,
        secret: secret
    }, JSON.stringify(signalData));

    enterControlledMode(name)

    window.ea.minimize()
}

function rtcPcClose() {
    peerClose(pc).then(() => {
        window.ea.unmaximize()
    })
}

async function rtcPc_Close() {
    peerClose(pc_).then(() => {
        window.ea.restore()
    })
}

/**
 * 分层异步关闭Peer，消除DtlsTransport报错，最小化SCTP abort日志
 * @param {RTCPeerConnection|null} peer
 */
async function peerClose(peer) {
    if (!peer) return;

    try {
        // 同步关闭所有DataChannel、释放媒体轨道
        const dcList = peer.dataChannels ? [...peer.dataChannels] : [];
        for (const dc of dcList) {
            try {
                if (dc.readyState !== "closed") dc.close();
            } catch (e) {
            }
        }

        // 停止发送轨道（本机屏幕/摄像头）
        peer.getSenders().forEach(sender => {
            try {
                if (sender.track) sender.track.stop();
                sender.replaceTrack(null);
            } catch (e) {
            }
        });

        // 停止接收远端视频轨道
        peer.getReceivers().forEach(receiver => {
            try {
                if (receiver.track) receiver.track.stop();
            } catch (e) {
            }
        });

        // 最后关闭连接
        peer.close();
    } catch (err) {
        pushLog("系统", `RTC关闭异常: ${err.message}`, "log-err");
    }
}

// 对外发送dc消息
function sendDCMessage(channel, data) {
    // 校验通道状态，必须open才能发
    if (!channel || channel.readyState !== "open") {
        pushLog("系统", "数据通道未打开，发送失败", "log-err");
    } else {
        try {
            // 对象转字符串发送，dc只支持字符串/二进制
            const msg = typeof data === "string" ? data : JSON.stringify(data);
            channel.send(msg);
        } catch (err) {
            pushLog("系统", "发送DC消息异常：" + err.message, "log-err");
        }
    }
}