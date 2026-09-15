'use strict';
// Settings-button only. No shell strings, downloads, policy bypasses or silent extension installation.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn,execFile} = require('node:child_process');
const {promisify} = require('node:util');
const distribution = require('../distribution.json');
function createInstallation(options = {}) {
  const platform = options.platform || process.platform, env = options.env || process.env;
  const catalog = options.distribution || distribution;
  const exists = options.exists || fs.existsSync;
  const run = options.run || ((file,args) => new Promise((resolve,reject) => {
    const child = spawn(file,args,{detached:true,stdio:'ignore'});
    child.once('error',reject); child.once('spawn',() => {child.unref(); resolve();});
  }));
  const directory = path.resolve(__dirname,'../extension');
  const safariApp = path.resolve(__dirname,'../native/My Browser.app');
  const verifySafari = options.verifySafari || (async () => {
    await promisify(execFile)('/usr/bin/codesign',['--verify','--deep','--strict',safariApp],{timeout:15000});
    await promisify(execFile)('/usr/sbin/spctl',['--assess','--type','execute',safariApp],{timeout:15000});
  });
  function app(browser) {
    if (platform === 'darwin') {
      const name = {chrome:'Google Chrome',edge:'Microsoft Edge',safari:'Safari'}[browser];
      return ['/Applications/'+name+'.app','/System/Applications/'+name+'.app',path.join(options.home || os.homedir(),'Applications',name+'.app')].find(exists);
    }
    if (platform === 'win32' && browser !== 'safari') {
      const suffix = browser === 'chrome' ? ['Google','Chrome','Application','chrome.exe'] : ['Microsoft','Edge','Application','msedge.exe'];
      return [env.PROGRAMFILES,env['PROGRAMFILES(X86)'],env.LOCALAPPDATA].filter(Boolean).map(base => path.win32.join(base,...suffix)).find(exists);
    }
    if (platform === 'linux' && browser !== 'safari') return (browser === 'chrome' ? ['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'] : ['/usr/bin/microsoft-edge']).find(exists);
  }
  function storeUrl(browser) {
    const url = browser === 'safari' ? catalog.safari.appStoreUrl : catalog[browser]?.storeUrl;
    if (!url) return null;
    const u = new URL(url);
    const host = {chrome:'chromewebstore.google.com',edge:'microsoftedge.microsoft.com',safari:'apps.apple.com'}[browser];
    if (u.protocol !== 'https:' || u.hostname !== host || u.username || u.password) throw new Error('Invalid packaged store URL.');
    return u.href;
  }
  function status() {
    return {platform,browsers:['chrome','edge','safari'].map(browser => {
      const supported = browser !== 'safari' || platform === 'darwin';
      return {browser,supported,installed:supported && !!app(browser),published:!!storeUrl(browser),bundled:browser === 'safari' && platform === 'darwin' && exists(safariApp)};
    })};
  }
  async function open(browser,mode = 'store') {
    if (!['chrome','edge','safari'].includes(browser) || !['store','developer','reload'].includes(mode)) return {ok:false,error:'INVALID_INSTALL_TARGET',execution:'not_executed'};
    const executable = app(browser);
    if (!executable) return {ok:false,error:'BROWSER_NOT_INSTALLED',execution:'not_executed'};
    if (browser === 'safari' && mode === 'store' && exists(safariApp)) {
      try {await verifySafari();} catch {return {ok:false,error:'SIGNATURE_REQUIRED',message:'The Safari app did not pass macOS signature and distribution checks. No app was launched.',execution:'not_executed'};}
      try {await run('/usr/bin/open',[safariApp]);return {ok:true,execution:'executed',stage:'awaiting_browser_confirmation',installed:false};}
      catch {return {ok:false,error:'OPEN_OUTCOME_UNKNOWN',execution:'unknown'};}
    }
    const url = mode === 'store' ? storeUrl(browser) : browser === 'safari' ? null : browser+ '://extensions/';
    if (!url) return {ok:false,error:'RELEASE_REQUIRED',message:'The publisher must provide an approved extension store release / signed Safari app. Developer loading is not a finished installation.',execution:'not_executed'};
    try {
      if (platform === 'darwin') await run('/usr/bin/open',['-a',executable,url]);
      else await run(executable,[url]);
      // Reveal only this packaged extension, never a caller-supplied path.
      if (mode === 'developer') {
        if (platform === 'darwin') await run('/usr/bin/open',['-R',directory]);
        else if (platform === 'win32') await run(path.win32.join(env.WINDIR || 'C:\\Windows','explorer.exe'),[directory]);
        else await run('/usr/bin/xdg-open',[directory]);
      }
      return {ok:true,execution:'executed',stage:'awaiting_browser_confirmation',installed:false};
    } catch {return {ok:false,error:'OPEN_OUTCOME_UNKNOWN',message:'Check whether the browser or installer opened. No installation success is claimed.',execution:'unknown'};}
  }
  return {status,open};
}
module.exports = {createInstallation};
