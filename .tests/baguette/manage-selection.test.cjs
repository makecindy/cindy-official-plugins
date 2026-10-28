const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const device=(udid,state='Shutdown')=>({udid,name:'Device '+udid,state,runtime:'iOS 27',deviceType:'iPhone'});

function fixture(devices,respond) {
  const nodes=new Map(),calls=[];let live=devices.map(d=>({...d}));
  const descendants=n=>n.children.flatMap(c=>[c,...descendants(c)]);
  const element=(tag,props={},children=[])=>{
    const n={tag,props,children:children.filter(Boolean),dataset:{},style:{},getBoundingClientRect:()=>({left:10,bottom:40,width:160,height:120}),classList:{contains:()=>false,toggle(){}},listeners:{},textContent:props.text || '',
      setAttribute(k,v){this.props[k]=v;},getAttribute(k){return this.props[k];},append(...kids){this.children.push(...kids);},replaceChildren(...kids){this.children=kids;},
      querySelector(selector){return descendants(this).find(c=>selector==='.rename input' ? c.tag==='input'&&c.parent?.props.class==='rename' : false)||null;},
      querySelectorAll(selector){return descendants(this).filter(c=>selector==='.row'&&c.props.class==='row');},
      closest(selector){for(let c=this;c;c=c.parent)if(selector==='.row'&&c.props.class==='row')return c;return null;},
      focus(){context.document.activeElement=this;},select(){this.focus();},showModal(){this.open=true;},close(){this.open=false;},remove(){this.removed=true;},
      addEventListener(k,fn){this.listeners[k]=fn;}};
    for(const child of n.children)child.parent=n;
    return n;
  };
  const get=id=>{if(!nodes.has(id))nodes.set(id,element('div'));return nodes.get(id);};
  const body=element('body');
  const context={document:{getElementById:get,body,documentElement:{clientWidth:800,clientHeight:700},addEventListener(){},querySelector(){return null;}},localStorage:{getItem:()=>null,setItem(){}},clearTimeout(){},setTimeout(){},
    CindySimPages:{locale:()=>new Promise(()=>{}),h:element,GLYPH:{iphone:''},memoryPicker:()=>null,memoryBadge:()=>null,
      rpc:async(action,params)=>{calls.push({action,params});
        if(action==='manage_state')return {ok:true,devices:live.map(d=>({...d})),settings:{enabled:false}};
        const result=respond?await respond(action,params):{ok:true};
        if(result.ok && result.outcome!=='partial') {if(action==='delete')live=live.filter(d=>d.udid!==params.udid);if(action==='shutdown')live=live.map(d=>d.udid===params.udid?{...d,state:'Shutdown'}:d);}
        return result;
      }},CindySimModel:{runtimeLabel:r=>r}};
  vm.runInNewContext(fs.readFileSync('baguette-simulator/manage.js','utf8')+`
    state={ok:true,devices:${JSON.stringify(devices)},settings:{enabled:false}};selected=state.devices[0]?.udid;
    globalThis.page={row,chooseRow,toggleSelection,renderList,confirmBatch,runBatch,selectionMenu,
      selected:()=>selected,checked:()=>[...checked],batch:()=>batch,
      filter:q=>{query=q;renderList();},selectAll:()=>{checked.clear();for(const d of filteredDevices())checked.add(d.udid);renderList();},
      devices:()=>state.devices,
      restarting:phase=>{state.settings.enabled=true;state.devices[0].state=phase;state.devices[0].operation={name:'settings_restart'};shown={udid:selected,url:'http://viewer/control'};document.getElementById('screen').src=shown.url;renderDetail();}};`,context);
  return {page:context.page,get,body,calls,document:context.document};
}

test('renaming from a focused row menu keeps the editor focused instead of restoring row focus',()=>{
 const f=fixture([device('a')]);f.page.renderList();
 const row=f.get('list').querySelectorAll('.row')[0];row.focus();
 const more=row.children[1].children[0].children.at(-1);
 more.props.onclick({stopPropagation(){},currentTarget:more});
 const menu=f.body.children.at(-1);
 const rename=menu.children.find(n=>n.children[0]?.props.text==='Rename');assert.ok(rename);
 rename.props.onclick();
 assert.equal(f.document.activeElement.tag,'input');
 assert.equal(f.document.activeElement.props.value,'Device a');
 assert.equal(f.calls.length,0,'entering rename never submits an unchanged name');
});

test('management refresh keeps the controller alive through shutdown and boot phases of restart',()=>{
 const f=fixture([device('a','Booted')]);
 for(const phase of ['Shutdown','Booting']){
  f.page.restarting(phase);
  assert.equal(f.get('screen').src,'http://viewer/control',phase);
 }
 assert.equal(f.calls.length,0,'polling does not launch a replacement viewer or device');
});

test('row and modifier selection preserve the preview; ranges follow visible running/off order',()=>{
  const f=fixture([device('a'),device('b','Booted'),device('c'),device('d')]);
  f.page.chooseRow(device('a'),{});
  f.page.chooseRow(device('c'),{ctrlKey:true});
  assert.deepEqual(Array.from(f.page.checked()),['a','c']);assert.equal(f.page.selected(),'a');
  assert.equal(f.page.row(device('c')).props['aria-selected'],'true');
  assert.ok(f.page.row(device('c')).children.every(n=>n.tag!=='input'),'selection is a row highlight without checkboxes');
  f.page.toggleSelection(device('b'),true);
  assert.deepEqual(new Set(f.page.checked()),new Set(['c','b','a']));
  f.page.toggleSelection(device('a'));
  assert.deepEqual(new Set(f.page.checked()),new Set(['c','b']));
  f.page.chooseRow(device('d'),{});assert.equal(f.page.selected(),'d');
  assert.deepEqual(Array.from(f.page.checked()),['d'],'plain click replaces a multiple selection');
  assert.equal(f.calls.length,0,'selection alone never opens, boots or stops a device');
});

test('search keeps existing selection, selects only visible matches, and reports hidden targets',()=>{
  const f=fixture([device('a'),device('b'),device('c')]);
  f.page.toggleSelection(device('a'));f.page.toggleSelection(device('b'));f.page.filter('device b');
  assert.deepEqual(new Set(f.page.checked()),new Set(['a','b']));
  f.page.selectionMenu(device('b'),null,{x:20,y:20});
  assert.match(f.body.children.at(-1).children[0].textContent,/2 selected.*1 hidden/);
  f.page.selectAll();assert.deepEqual(Array.from(f.page.checked()),['b'],'select all is scoped to current results');
});

test('right-click preserves a selected group but replaces it for an unselected row; menu actions use that scope',()=>{
  const f=fixture([device('a','Booted'),device('b'),device('c')]);
  f.page.toggleSelection(device('a'));f.page.toggleSelection(device('b'));
  f.page.selectionMenu(device('a'),null,{x:30,y:30});
  let menu=f.body.children.at(-1);
  assert.deepEqual(Array.from(f.page.checked()),['a','b']);assert.equal(f.page.selected(),'a');
  assert.equal(menu.children[1].children[0].textContent,'Shut down (1)');
  assert.equal(menu.children[2].children[0].textContent,'Delete (2)…');
  menu.children[2].props.onclick();
  assert.equal(f.body.children.at(-1).children[0].children[2].children.length,2);
  assert.equal(f.calls.length,0,'opening a menu or confirmation sends no mutation');
  f.page.selectionMenu(device('c'),null,{x:30,y:30});
  assert.deepEqual(Array.from(f.page.checked()),['c']);
  menu=f.body.children.at(-1);
  assert.ok(menu.children.some(n=>n.children[0]?.textContent==='Rename'));
  assert.equal(f.page.selected(),'a','context selection does not restart the preview');
});

test('destructive confirmation lists exact identities, cancellation sends nothing, confirmation freezes targets',async()=>{
  const f=fixture([device('a'),device('b'),device('c')]);
  f.page.toggleSelection(device('a'));f.page.toggleSelection(device('b'));f.page.confirmBatch('delete');
  let dialog=f.body.children.at(-1),sheet=dialog.children[0],actions=sheet.children.at(-1);
  assert.equal(sheet.children[2].children.length,2);assert.equal(f.calls.length,0);
  actions.children[0].listeners.click();assert.equal(dialog.removed,true);assert.equal(f.calls.length,0);
  f.page.confirmBatch('delete');dialog=f.body.children.at(-1);actions=dialog.children[0].children.at(-1);
  f.page.toggleSelection(device('c')); // a later change cannot expand the confirmed scope
  actions.children[1].listeners.click();await settle();
  assert.deepEqual(f.calls.filter(c=>c.action==='delete').map(c=>c.params.udid),['a','b']);
  assert.deepEqual(Array.from(f.page.checked()),['c']);
});

test('batch shutdown skips off devices; serial failures retain only unfinished selection',async()=>{
  let release;const pending=new Promise(r=>release=r);
  const f=fixture([device('a','Booted'),device('b','Booted'),device('c')],async(_a,p)=>p.udid==='a'?pending:{ok:false,errorCode:'BUSY'});
  for(const d of f.page.devices())f.page.toggleSelection(d);
  f.page.confirmBatch('shutdown');const sheet=f.body.children.at(-1).children[0];
  assert.equal(sheet.children[2].children.length,2,'off devices are not in the shutdown scope');
  sheet.children.at(-1).children[1].listeners.click();await settle();
  assert.equal(f.calls.filter(c=>c.action==='shutdown').length,1);
  f.page.toggleSelection(device('c'));assert.equal(f.page.checked().length,3,'selection is locked while executing');
  assert.equal(f.get('detail').inert,true);
  release({ok:true});await settle();
  assert.deepEqual(f.calls.filter(c=>c.action==='shutdown').map(c=>c.params.udid),['a','b']);
  assert.deepEqual(new Set(f.page.checked()),new Set(['b','c']));
  assert.match(f.get('message').textContent,/1 of 2 completed.*Device b/);
  assert.equal(f.get('detail').inert,false);
});

test('uncertain execution stops the batch without retrying or losing pending selections',async()=>{
  const f=fixture([device('a'),device('b')],async()=>{throw Object.assign(Error('timeout'),{code:'TIMEOUT'});});
  for(const d of f.page.devices())f.page.toggleSelection(d);
  await f.page.runBatch('delete',f.page.devices());
  assert.equal(f.calls.filter(c=>c.action==='delete').length,1);
  assert.equal(f.page.checked().length,2);assert.match(f.get('message').textContent,/Remaining devices were not attempted/);
});

test('completed deletion with record warnings is not offered for repetition',async()=>{
  const f=fixture([device('a')],async()=>({ok:true,execution:'executed',taskBindingError:{code:'WRITE_FAILED'}}));
  f.page.toggleSelection(device('a'));await f.page.runBatch('delete',f.page.devices());
  assert.equal(f.page.checked().length,0);assert.equal(f.page.devices().length,0);
  assert.match(f.get('message').textContent,/1 of 1 completed.*saved records/);
});
