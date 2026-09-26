'use strict';
// Existing banks describe their bundled runtime in environment. Only the
// explicit macOS arm64 requirement applies this guard; custom portable banks
// use their own preflight rather than inheriting Cindy's default runtime.
function checkPlatform(environment, platform=process.platform, arch=process.arch){
 if(typeof environment==='string'&&/macOS\s+arm64/i.test(environment)&&(platform!=='darwin'||arch!=='arm64'))throw Error('Selected question requires macOS arm64');
}
module.exports={checkPlatform};
