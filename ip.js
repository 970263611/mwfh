const {get} = require("node:https");

function getPublicIPv6() {
    return new Promise((resolve, reject) => {
        get('https://api6.ipify.org', {timeout: 5000}, res => {
            let ip = '';
            res.on('data', c => ip += c);
            res.on('end', () => resolve(ip.trim()));
        }).on('error', reject);
    })
}

module.exports = {
    getPublicIPv6
}