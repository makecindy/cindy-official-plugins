'use strict';
const codes={Enter:40,Escape:41,Backspace:42,Tab:43,Space:44,Minus:45,Equal:46,BracketLeft:47,BracketRight:48,Backslash:49,Semicolon:51,Quote:52,Backquote:53,Comma:54,Period:55,Slash:56,ArrowRight:79,ArrowLeft:80,ArrowDown:81,ArrowUp:82,NumpadDivide:84,NumpadMultiply:85,NumpadSubtract:86,NumpadAdd:87,NumpadEnter:88,Numpad0:98,NumpadDecimal:99,NumpadEqual:103};
for(let i=0;i<26;i++)codes['Key'+String.fromCharCode(65+i)]=4+i;
for(let i=1;i<=9;i++){codes['Digit'+i]=29+i;codes['Numpad'+i]=88+i;}codes.Digit0=39;
function chord(code,mods=[]){if(!Object.hasOwn(codes,code)||!Array.isArray(mods)||mods.some(m=>!['control','shift','option','command'].includes(m)))throw Error('Invalid keyboard chord');return [codes[code],mods.reduce((bits,m)=>bits|({control:1,shift:2,option:4,command:8}[m]),0)];}

// What models write for a key, mapped to W3C codes: "Enter", "esc", "cmd+a",
// "Shift+Tab", "a", "A" (= shift+a), "7", "ArrowUp" or "up".
const ALIASES={enter:'Enter',return:'Enter',esc:'Escape',escape:'Escape',backspace:'Backspace',delete:'Backspace',del:'Backspace',tab:'Tab',space:'Space',spacebar:'Space',
  up:'ArrowUp',down:'ArrowDown',left:'ArrowLeft',right:'ArrowRight',arrowup:'ArrowUp',arrowdown:'ArrowDown',arrowleft:'ArrowLeft',arrowright:'ArrowRight'};
const MODIFIERS={cmd:'command',command:'command','⌘':'command',meta:'command',ctrl:'control',control:'control','⌃':'control',alt:'option',opt:'option',option:'option','⌥':'option',shift:'shift','⇧':'shift'};
// US layout: unshifted punctuation and the character typed with Shift.
const PUNCT={'-':'Minus','=':'Equal','[':'BracketLeft',']':'BracketRight','\\':'Backslash',';':'Semicolon',"'":'Quote','`':'Backquote',',':'Comma','.':'Period','/':'Slash',' ':'Space'};
const SHIFTED={'_':'-','+':'=','{':'[','}':']','|':'\\',':':';','"':"'",'~':'`','<':',','>':'.','?':'/','!':'1','@':'2','#':'3','$':'4','%':'5','^':'6','&':'7','*':'8','(':'9',')':'0'};
const EXAMPLES='Enter, Escape, Backspace, Tab, Space, ArrowUp/Down/Left/Right (or up/down/left/right), a single character such as "a", "A" or "7", or W3C codes like KeyA and Digit7; add modifiers with +, e.g. "cmd+a", "shift+Tab"';

function keyOf(name){
  if(Object.hasOwn(codes,name))return {code:name,shift:false};
  const alias=ALIASES[name.toLowerCase()];
  if(alias)return {code:alias,shift:false};
  if(name.length===1){
    if(/[a-z]/.test(name))return {code:'Key'+name.toUpperCase(),shift:false};
    if(/[A-Z]/.test(name))return {code:'Key'+name,shift:true};
    if(/[0-9]/.test(name))return {code:'Digit'+name,shift:false};
    if(PUNCT[name])return {code:PUNCT[name],shift:false};
    if(SHIFTED[name])return {...keyOf(SHIFTED[name]),shift:true};
  }
  // Case-insensitive W3C names: "keya", "digit7", "arrowup".
  const found=Object.keys(codes).find(c=>c.toLowerCase()===name.toLowerCase());
  return found?{code:found,shift:false}:null;
}

/** "cmd+shift+z" → {code:'KeyZ', modifiers:['command','shift']}; throws with the accepted names. */
function parseKey(text){
  const raw=String(text??'');
  // A lone "+" is the key itself; otherwise "+" separates modifiers from the key.
  const parts=raw==='+'?['+']:raw.endsWith('++')?[...raw.slice(0,-2).split('+').filter(Boolean),'+']:raw.split('+').map(s=>s.trim()).filter(Boolean);
  const name=parts.pop();
  const key=name===undefined?null:keyOf(name);
  if(!key)throw Object.assign(new Error(`Unknown key ${JSON.stringify(raw)}. Use ${EXAMPLES}.`),{code:'INVALID_ARGUMENT'});
  // "A" alone types a capital; in a chord like "cmd+A" the letter just names the key.
  const modifiers=new Set(key.shift&&(!parts.length||!/^[A-Z]$/.test(name))?['shift']:[]);
  for(const part of parts){
    const m=MODIFIERS[part.toLowerCase()];
    if(!m)throw Object.assign(new Error(`Unknown modifier ${JSON.stringify(part)} in ${JSON.stringify(raw)}. Use cmd, ctrl, option or shift.`),{code:'INVALID_ARGUMENT'});
    modifiers.add(m);
  }
  return {code:key.code,modifiers:[...modifiers]};
}

/** True when every character can be typed on a US keyboard (what HID typing supports). */
function typeable(text){return /^[\x20-\x7e\n\t]*$/.test(text);}

module.exports={chord,parseKey,typeable};
