'use strict';
const unavailable=()=>Object.assign(Error('Python 3 无法运行，请安装 Python 3 并确保 Cindy 的 PATH 能找到 python3，重启 Cindy 后重试；已有作答和成绩保留。'),{code:'PYTHON_UNAVAILABLE'});
function startupError(code){
 if(code==='ENOENT')return unavailable();
 const action=['EACCES','EPERM'].includes(code)?'请检查 Python 执行权限。':['EMFILE','ENFILE','EAGAIN','ENOMEM'].includes(code)?'请关闭不需要的程序，释放系统资源后重试。':'请检查 Python 程序和系统资源后重试。';
 return Object.assign(Error(`Python 无法启动（${code||'UNKNOWN'}）。${action}已有作答和成绩保留。`),{code:code||'PYTHON_START_FAILED',pythonStartup:true});
}
async function preflight(runCommand){
 const r=await runCommand('python3',['-I','-c','import sys; sys.exit(0 if sys.version_info.major == 3 else 1)'],{timeout:10000});
 if(r.errorCode)throw startupError(r.errorCode);
 if(r.code!==0||r.timedOut)throw unavailable();
 return {ok:true};
}
module.exports={preflight,unavailable,startupError};
