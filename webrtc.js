let pc

async function startRtc(node) {
    // 1. 强制ICE优先IPv6、只收集本地主机IPv6地址
    const rtcConfig = {
        iceServers: [{urls: "stun:stun.l.google.com:19302"}],
        // 只使用本机host候选（公网IPv6无NAT足够直连）
        iceTransportPolicy: 'all'
    }
    pc = new RTCPeerConnection(rtcConfig)

    const remoteStream = new MediaStream();
    pc.ontrack = (e) => {
        console.log('发起端收到远端轨道', e.track.kind)
        remoteStream.addTrack(e.track);
        const videoDom = document.querySelector("video");
        videoDom.srcObject = remoteStream;
        // 用户交互后手动播放，规避浏览器自动播放限制
        videoDom.play().catch(err => console.error('视频播放失败：', err));
    };

    const dc = pc.createDataChannel('mwfh')
    dc.onopen = () => {
        console.log('纯IPv6 WebRTC通道建立成功')
        dc.send('Only IPv6 connect')
    }
    dc.onmessage = (ev) => {
        console.log('收到消息:', ev.data)
    }

    // 创建Offer
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    // 等待收集完所有IPv6候选
    const signalData = await waitIPv6IceComplete(pc)
    // HTTP一次性发送SDP+仅IPv6候选
    window.ea.viewOtherNode(node, JSON.stringify(signalData))
}

// 接收对端Answer并加载IPv6候选
async function handleRemoteAnswer({sdp, candidates}) {
    await pc.setRemoteDescription(sdp)
    // 只添加远端传过来的IPv6候选
    for (const cand of candidates) {
        await pc.addIceCandidate(cand)
    }
}

async function handleRemoteOffer(name, addr, secret, {sdp, candidates}) {
    const rtcConfig = {iceServers: [{urls: "stun:stun.l.google.com:19302"}]}
    const pc_ = new RTCPeerConnection(rtcConfig)
    navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true
    }).then(async stream => {
        for (const track of stream.getTracks()) {
            pc_.addTrack(track, stream);
        }
        const video = document.querySelector('video')
        video.srcObject = stream
        video.onloadedmetadata = (e) => video.play()
    }).catch(err => {
        pushLog('错误', err.message, 'log-err')
    })

    pc_.ondatachannel = (e) => {
        const dc = e.channel
        // TODO
    }

    // 加载对方Offer和对方候选
    await pc_.setRemoteDescription(sdp)
    for (const cand of candidates) {
        await pc_.addIceCandidate(cand)
    }

    // 生成Answer + 收集本机候选
    const answer = await pc_.createAnswer()
    await pc_.setLocalDescription(answer)
    const signalData = await waitIPv6IceComplete(pc_)

    // HTTP回传
    window.ea.callbackViewNode({
        name: name,
        addr: addr,
        secret: secret
    }, JSON.stringify(signalData))
}

/**
 * 判断候选是否为IPv6地址
 * @param {RTCIceCandidate} cand
 */
function isIPv6Candidate(cand) {
    if (!cand || !cand.address) return false
    // 地址包含冒号就是IPv6
    return cand.address.includes(':')
}


function waitIPv6IceComplete(pc) {
    return new Promise((resolve) => {
        const ipv6Candidates = []
        pc.onicecandidate = (e) => {
            if (e.candidate) {
                // if (e.candidate && isIPv6Candidate(e.candidate)) {
                ipv6Candidates.push(e.candidate)
            } else if (!e.candidate) {
                resolve({sdp: pc.localDescription, candidates: ipv6Candidates})
            }
        }
    })
}