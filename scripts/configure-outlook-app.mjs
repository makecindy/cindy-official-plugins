import fs from 'node:fs';
const [cloud,clientId,...extra]=process.argv.slice(2);
if(extra.length || !['global','china'].includes(cloud) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId || '')) {
  console.error('Usage: node scripts/configure-outlook-app.mjs global|china <registered-public-client-id>');process.exit(1);
}
const file=new URL('../outlook-mail/ghost.json',import.meta.url);
const m=JSON.parse(fs.readFileSync(file,'utf8'));
const entry=m.network.secrets.find(s=>s.key==='outlook_'+cloud);
if(!entry || entry.source!=='oauth')throw new Error('Expected OAuth declaration missing');
entry.oauth.clientId=clientId;
fs.writeFileSync(file,JSON.stringify(m,null,2)+'\n');
console.log('Updated '+cloud+' public application identity. Repack and verify real sign-in before release.');
