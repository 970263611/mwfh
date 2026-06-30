const os = require('os');
const https = require('https');

/**
 * 优先网络请求拿真实出口IPv6，失败则读取网卡稳定永久公网IPv6
 * @returns {Promise<string|null>} 公网IPv6，无则返回null
 */
async function getPublicIPv6() {
    // 第一步：网络请求获取外网真实出口IP
    try {
        const ipv6 = await fetchIpv6ByNet();
        if (ipv6) return ipv6;
    } catch (err) {
    }
    return getStableIpv6FromCard();
}

// 网络请求获取出口IPv6
function fetchIpv6ByNet() {
    return new Promise((resolve, reject) => {
        const req = https.get({
            hostname: 'v6.ident.me',
            family: 6,
            timeout: 3000
        }, res => {
            let buf = '';
            res.on('data', chunk => buf += chunk.toString().trim());
            res.on('end', () => resolve(buf || null));
        });
        req.on('error', reject);
        req.setTimeout(3000, () => {
            req.destroy();
            reject(new Error('timeout'));
        });
    });
}

// 本地网卡获取稳定永久公网IPv6（过滤临时/链路本地/私有）
function getStableIpv6FromCard() {
    const interfaces = os.networkInterfaces();
    for (const ifName of Object.keys(interfaces)) {
        const addrList = interfaces[ifName];
        for (const info of addrList) {
            if (info.family !== 'IPv6' || info.internal) continue;
            const ip = info.address;
            // 过滤链路本地、私有ULA
            if (ip.startsWith('fe80:') || ip.startsWith('fd')) continue;
            // 仅全局公网段
            if (!/^[23]/.test(ip)) continue;
            // 跳过临时隐私地址
            const isTemp = info.flags?.some(f => f === 'temporary');
            if (isTemp) continue;
            return ip;
        }
    }
    return null;
}

module.exports = {
    getPublicIPv6
}