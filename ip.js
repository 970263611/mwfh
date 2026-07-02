const os = require('os')
const https = require('https')

/**
 * 获取公网 IPv6 地址
 * 优先通过网络请求获取真实出口 IPv6，失败则从网卡读取稳定公网 IPv6
 * @returns {Promise<string|null>} 公网 IPv6 地址，无则返回 null
 */
async function getPublicIPv6() {
    // 方式一：网络请求获取出口 IP
    try {
        const ipv6 = await fetchIpv6ByNet()
        if (ipv6) return ipv6
    } catch (err) {
        // 静默失败，继续尝试网卡方式
    }
    // 方式二：从本地网卡获取稳定公网 IPv6
    return getStableIpv6FromCard()
}

/**
 * 通过 v6.ident.me 服务获取出口 IPv6
 * @returns {Promise<string|null>}
 */
function fetchIpv6ByNet() {
    return new Promise((resolve, reject) => {
        const req = https.get({
            hostname: 'v6.ident.me',
            family: 6,           // 强制 IPv6
            timeout: 3000
        }, res => {
            let buf = ''
            res.on('data', chunk => buf += chunk.toString().trim())
            res.on('end', () => resolve(buf || null))
        })
        req.on('error', reject)
        req.setTimeout(3000, () => {
            req.destroy()
            reject(new Error('timeout'))
        })
    })
}

/**
 * 从本地网卡获取稳定永久公网 IPv6
 * 过滤临时地址、链路本地地址、私有 ULA 地址
 * @returns {string|null}
 */
function getStableIpv6FromCard() {
    const interfaces = os.networkInterfaces()

    for (const ifName of Object.keys(interfaces)) {
        const addrList = interfaces[ifName]

        for (const info of addrList) {
            // 只处理非内部的 IPv6 地址
            if (info.family !== 'IPv6' || info.internal) continue

            const ip = info.address

            // 过滤链路本地（fe80:）和私有 ULA（fd 开头）
            if (ip.startsWith('fe80:') || ip.startsWith('fd')) continue

            // 只保留全球单播地址（2 或 3 开头）
            if (!/^[23]/.test(ip)) continue

            // 跳过临时隐私地址
            const isTemp = info.flags?.some(f => f === 'temporary')
            if (isTemp) continue

            // 返回第一个符合条件的稳定公网 IPv6
            return ip
        }
    }

    return null
}

module.exports = {
    getPublicIPv6
}
