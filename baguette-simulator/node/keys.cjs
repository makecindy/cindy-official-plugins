'use strict';
const codes={Enter:40,Escape:41,Backspace:42,Tab:43,Space:44,Minus:45,Equal:46,BracketLeft:47,BracketRight:48,Backslash:49,Semicolon:51,Quote:52,Backquote:53,Comma:54,Period:55,Slash:56,ArrowRight:79,ArrowLeft:80,ArrowDown:81,ArrowUp:82,NumpadDivide:84,NumpadMultiply:85,NumpadSubtract:86,NumpadAdd:87,NumpadEnter:88,Numpad0:98,NumpadDecimal:99,NumpadEqual:103};
for(let i=0;i<26;i++)codes['Key'+String.fromCharCode(65+i)]=4+i;
for(let i=1;i<=9;i++){codes['Digit'+i]=29+i;codes['Numpad'+i]=88+i;}codes.Digit0=39;
function chord(code,mods=[]){if(!Object.hasOwn(codes,code)||!Array.isArray(mods)||mods.some(m=>!['control','shift','option','command'].includes(m)))throw Error('Invalid keyboard chord');return [codes[code],mods.reduce((bits,m)=>bits|({control:1,shift:2,option:4,command:8}[m]),0)];}
module.exports={chord};
