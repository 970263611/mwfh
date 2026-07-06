const path = require('path');

// 加载编译好的原生C++模块
const captureAddon = require(path.join(__dirname, 'native/build/Release/capture_addon.node'));

// C++采集到帧后会触发这个回调
function onNativeFrame(rgbaBuffer, width, height) {
    console.log('收到画面帧', `宽${width} 高${height}`);
}

function start() {
    return captureAddon.start()
}

function invoke() {
    return captureAddon.invoke()
}

function destroy() {
    return captureAddon.stop();
}

module.exports = {
    start,
    invoke,
    destroy
}

