var chrome=globalThis.browser || globalThis.chrome;
const button=document.querySelector('#refresh');
async function refresh(){
  button.disabled=true;
  try{
    const response=await Promise.race([chrome.runtime.sendMessage({type:'connection-status'}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('timeout')),10000))]);
    const c=response?.connection || {};
    document.querySelector('#status').textContent=c.connected ? 'Ready · '+(c.browser || 'Browser')+' connected' : 'Waiting for Cindy';
    document.querySelector('#detail').textContent=c.connected ? 'Local bridge · 127.0.0.1:'+c.port+' · v'+c.version : c.message || 'Open My Browser settings in Cindy, then check again.';
  }catch{document.querySelector('#status').textContent='Extension needs attention';document.querySelector('#detail').textContent='Reload or enable My Browser in your browser extensions settings, then check Cindy.';}
  finally{button.disabled=false;}
}
button.onclick=refresh;refresh();
