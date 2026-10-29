import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source=await fs.readFile(new URL('../my-browser/extension/library.js',import.meta.url),'utf8');
const content=await fs.readFile(new URL('../my-browser/extension/content.js',import.meta.url),'utf8');
const pdf=await fs.readFile(new URL('../my-browser/extension/reader-pdf.js',import.meta.url),'utf8');
const bridge=await fs.readFile(new URL('../my-browser/node/bridge.cjs',import.meta.url),'utf8');
const background=await fs.readFile(new URL('../my-browser/extension/background.js',import.meta.url),'utf8');
const settings=await fs.readFile(new URL('../my-browser/settings.js',import.meta.url),'utf8');

test('text reader bounds total translation work before sending model requests',()=>{
  assert.match(source,/MAX_TEXT_TRANSLATION_PARTS=100/);
  assert.match(source,/MAX_TEXT_TRANSLATION_CHARS=200000/);
  assert.match(source,/parts\.some\(part=>part\.length>MAX_TEXT_TRANSLATION_PART\)\)throw Error\('IMPORT_TOO_LARGE'\)/);
});

test('content script listens for cross-tab preference changes',()=>{
  assert.match(content,/storage\?\.onChanged\?\.addListener\(onPreferencesChanged\)/);
  assert.match(content,/api\.storage\.local\.get\('cindyReadingPreferences'\)/);
  assert.match(content,/const merged=\{\.\.\.stored,\.\.\.changes\}/);
  assert.match(content,/Object\.assign\(prefs,merged\)/);
  assert.match(content,/autoSites:\{\[location\.origin\]:value\?true:undefined\}/);
  assert.match(content,/const videoWasEnabled=previous\.autoVideo!==false,videoIsEnabled=stored\.autoVideo!==false/);
  assert.match(content,/const relevantEnable=youtube\?!videoWasEnabled&&videoIsEnabled:!siteWasEnabled&&siteIsEnabled/);
  assert.match(content,/if\(relevantEnable\)\{nextAutoAttempt=0;if\(!videoSession\)autoOpen\(\);\}/);
  assert.match(content,/const videoTargetChanged=nextVideoTarget!==prefs\.videoTarget/);
  assert.match(content,/if\(videoTargetChanged&&videoSession\)reapplyVideoTarget\(nextVideoTarget\);/);
  assert.match(content,/function setVideoTarget\(value\)\{prefs\.videoTarget=value;reapplyVideoTarget\(value\);/);
  assert.match(content,/if\(!youtube&&\(translated\|\|translations\.size\)\)return;/);
  assert.match(content,/removeListener\(onPreferencesChanged\)/);
});

test('PDF reader bounds page translation before sending model requests',()=>{
  assert.match(pdf,/MAX_TRANSLATION_BATCHES=20/);
  assert.match(pdf,/MAX_TRANSLATION_CHARS=200000/);
  assert.match(pdf,/batches\.length>MAX_TRANSLATION_BATCHES\|\|totalCharacters>MAX_TRANSLATION_CHARS\)throw Error\('IMPORT_TOO_LARGE'\)/);
});

test('bridge learning access requires the paired extension challenge key and stays in the legacy port range',()=>{
  assert.match(bridge,/const pairedCredential\s*=/);
  assert.match(bridge,/const verifyProof\s*=/);
  assert.match(bridge,/const authRequired=client\.version===WIRE_VERSION/);
  assert.match(bridge,/const learning = new Map\(\), learningChallenges = new Map\(\)/);
  assert.match(bridge,/h\['x-my-browser-session'\] !== client\.session/);
  assert.match(bridge,/x-my-browser-learning-challenge/);
  assert.match(bridge,/verifyProof\(client\.publicKey,payload,proof\)/);
  assert.match(bridge,/capabilities:sessionAllowed&&authRequired\?\['learning-v1','learning-auth-v2'\]:\[\]/);
  assert.match(bridge,/bodyDigest=crypto\.createHash\('sha256'\)/);
  assert.match(bridge,/payload=challenge\+'\\\\n'\+req\.method\+'\\\\n'\+req\.url\+'\\\\n'\+bodyDigest/);
  assert.match(bridge,/req\.url\.startsWith\('\/learning\/'\)/);
  assert.match(bridge,/Array\.from\(\{length:10\},\(_,i\)=>18810\+i\)/);
  assert.match(background,/crypto\.subtle\.generateKey\(\{name:'ECDSA',namedCurve:'P-256'\}/);
  assert.match(background,/X-My-Browser-Key/);
  assert.match(background,/X-My-Browser-Learning-Challenge/);
  assert.match(background,/X-My-Browser-Proof/);
  assert.match(background,/learning-auth-v2/);
  assert.match(background,/if\(r\.challenge\)\{auth=auth\|\|await authReady\(\)\.catch\(\(\)=>null\);if\(!auth\)return null/);
  assert.match(background,/const digest=b64url\(await crypto\.subtle\.digest\('SHA-256'/);
  assert.match(background,/path\+'\\\\n'\+digest/);
  assert.match(background,/learningFetch\(call\.target,'\/learning\/cancel'/);
  assert.match(background,/target\.auth\|\|await authReady\(\)/);
  assert.match(background,/const videoIdentity = async url =>/);
  assert.match(background,/crypto\.subtle\.digest\('SHA-256'/);
  assert.match(background,/sessionStore\.set\(\{\[key\]:marker\}\)/);
});

test('installation copy matches the directory-only developer fallback',()=>{
  assert.match(settings,/storeNote:'The store is the normal installation path\. Directory loading is the only developer fallback included in this package; contributor build archives are not an installation route\.'/);
  assert.match(settings,/storeNote:'商店是普通安装路径；正式包只在「开发者安装（备用）」中提供目录加载，贡献者构建的归档不用于安装。'/);
  assert.doesNotMatch(settings,/zip(Open|Note|Step|Opened)/);
  assert.doesNotMatch(settings,/ZIP/);
});
