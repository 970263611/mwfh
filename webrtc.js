let pc
let pc_

// 收集全部ICE候选，5秒超时兜底
function waitAllIceComplete(pc) {
    return new Promise((resolve) => {
        const allCandidates = [];
        const timer = setTimeout(() => {
            console.warn("ICE收集超时，返回当前已收集候选");
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
        }
    };

    // ========== 核心修复：手动创建视频收发器，声明要接收视频 ==========
    pc.addTransceiver('video', {direction: 'recvonly'});

    // 接收远端视频轨道
    const remoteStream = new MediaStream();
    pc.ontrack = (e) => {
        console.log("✅ 收到远端轨道", e.track.kind);
        remoteStream.addTrack(e.track);
        videoDom.srcObject = remoteStream;
        videoDom.play().catch(err => console.error("视频播放失败：", err));
    };

    // 数据通道
    const dc = pc.createDataChannel("mwfh");
    dc.onopen = () => console.log("✅ 纯WebRTC数据通道建立成功");
    dc.onmessage = (ev) => console.log("收到DC消息:", ev.data);
    dc.onerror = (err) => console.error("DC异常：", err);

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

    pc_.ondatachannel = (e) => {
        const dc = e.channel;
        dc.onmessage = (ev) => console.log("应答方DC收到消息：", ev.data);
    };

    // 1. 载入对方Offer与ICE候选
    await pc_.setRemoteDescription(new RTCSessionDescription(sdp));
    for (const cand of candidates) {
        await pc_.addIceCandidate(new RTCIceCandidate(cand));
    }

    // 2. 获取屏幕流并添加
    let localStream;
    try {
        localStream = await navigator.mediaDevices.getDisplayMedia({
            video: {frameRate: {ideal: 60}}
        });
        console.log("本地轨道数量：", localStream.getTracks().length);
        for (const track of localStream.getTracks()) {
            pc_.addTrack(track, localStream);
        }
    } catch (err) {
        pushLog("错误", err.message, "log-err");
        return;
    }

    // 3. 生成Answer
    const answer = await pc_.createAnswer();
    console.log("Answer SDP内容：", answer.sdp);
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
    peerClose(pc)
}

function rtcPc_Close() {
    peerClose(pc_)
}

/**
 * 安全完整关闭RTCPeerConnection，无资源泄漏、减少底层报错日志
 * @param {RTCPeerConnection|null} peer - 要关闭的peer实例
 */
function peerClose(peer) {
    if (!peer) return;

    try {
        // 1. 关闭所有出站DataChannel（主动创建的通道）
        const dataChannels = peer.createDataChannel ? [peer.createDataChannel] : [];
        // 兼容远端主动创建的通道监听集合
        const dcList = dataChannels || [];
        [...dcList].forEach(dc => {
            try {
                if (dc.readyState !== "closed") {
                    dc.close();
                }
            } catch (_) {
            }
        });

        // 2. 停止所有本地发送轨道（本机屏幕/摄像头推流）
        peer.getSenders().forEach(sender => {
            const track = sender.track;
            if (track) {
                try {
                    track.stop();
                    sender.replaceTrack(null);
                } catch (_) {
                }
            }
        });

        // 3. 停止所有远端接收轨道（对方视频画面）
        peer.getReceivers().forEach(receiver => {
            const track = receiver.track;
            if (track) {
                try {
                    track.stop();
                } catch (_) {
                }
            }
        });

        // 4. 终止ICE收集，释放网络端口
        peer.close();
    } catch (err) {
        pushLog("系统", `断开RTC错误` + err.message, "log-err");
    }
}