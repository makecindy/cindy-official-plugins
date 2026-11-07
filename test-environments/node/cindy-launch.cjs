'use strict';
// Use the project's actual restart coordinator, including its migration,
// isolation, conflict, dependency and asset checks. Only transfer the final
// readiness wait to our supervisor; do not invoke dev:desktop directly.
const path=require('node:path'),{pathToFileURL}=require('node:url');
const {spawnSync}=require('node:child_process');
(async()=>{
  const root=process.argv[2],argv=process.argv.slice(3);
  if(!path.isAbsolute(root||'')||!process.env.XDT_DESKTOP_DEV_STARTUP_STATUS_FILE)throw new Error('PLUGIN_STARTUP_STATUS_REQUIRED');
  const coordinator=await import(pathToFileURL(path.join(root,'scripts/desktop-restart-runner.mjs')).href);
  if(typeof coordinator.runDesktopRestart!=='function'||typeof coordinator.assertDesktopRestartStepSucceeded!=='function')throw new Error('PROJECT_UPDATE_REQUIRED');
  coordinator.runDesktopRestart(argv,root,step=>{
    const args=step.progress==='launching'?step.args.filter(arg=>arg!=='--wait-ready'):step.args;
    const result=spawnSync(step.command,args,{cwd:root,env:process.env,stdio:'inherit'});
    coordinator.assertDesktopRestartStepSucceeded(step,result);
  });
})().catch(()=>{console.error('PLUGIN_LAUNCH_FAILED: inspect the project output above.');process.exitCode=1;});
