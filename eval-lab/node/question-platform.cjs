'use strict';
// Existing banks describe their bundled runtime in environment. Only the
// explicit macOS arm64 requirement applies this guard; custom portable banks
// use their own preflight rather than inheriting Cindy's default runtime.
function checkPlatform(environment, platform=process.platform, arch=process.arch){
 if(typeof environment==='string'&&(/macOS\s+arm64/i.test(environment)||environment==='darwin-arm64')&&(platform!=='darwin'||arch!=='arm64'))throw Object.assign(Error('此题库需要 Apple 芯片的 macOS，请在支持的设备上安装和运行，或导入兼容当前平台的题库。'),{code:'UNSUPPORTED_PLATFORM'});
}
module.exports={checkPlatform};
