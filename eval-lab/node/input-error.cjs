'use strict';
module.exports=function inputError(error,cleanup=false,phase='校准材料'){
 if(!cleanup&&error.code==='SYMLINK_REFUSED')return Object.assign(Error('材料包含符号链接，请改用普通文件后重试；已有作答保留。'),{code:error.code});
 const message=cleanup?`${phase}清理未完成，请检查存储权限和连接；已有文件保留，未重新执行。`:['ENOSPC','EDQUOT'].includes(error.code)?`${phase}复制失败，请释放磁盘空间后重试。`:['EACCES','EPERM','EROFS'].includes(error.code)?`${phase}复制失败，请检查存储读写权限后重试。`:`${phase}复制失败，请检查存储连接和材料是否可读后重试。`;
 return Object.assign(Error(message),{code:error.code||(phase==='校准材料'?'CALIBRATION_INPUT_FAILED':'GRADING_INPUT_FAILED')});
};
