const {test}=require('node:test'),assert=require('node:assert/strict');
const {aggregate}=require('../standings.js');const report=require('../lib/standings-report.cjs');
const q=id=>({questionId:id,title:id,revision:'v1',releaseHash:'release',distributionHash:'content'});
const r=(id,score,at,extra={})=>({...q(id),runId:id+at,model:'Luna',harness:'codex',provider:'openai',effort:'medium',status:'graded',scoreExact:String(score),gradedAt:at,...extra});
test('latest valid retest fills a bank across batches; blocked result never replaces valid',()=>{
 const rows=[r('a','1/2','2026-01-01'),r('a','1','2026-01-02'),r('a',null,'2026-01-03',{status:'environment_invalid'}),r('b','1/4','2026-01-04')];
 const [g]=aggregate(rows,[q('a'),q('b')]);assert.equal(g.total,1.25);assert.equal(g.complete,true);assert.equal(g.details[0].recentBlocked,true);assert.equal(g.runIds.length,2);
});
test('average uses question means, not attempt-weighted average; exact versions and configurations isolated',()=>{
 const rows=[r('a','0','2026-01-01'),r('a','1','2026-01-02'),r('b','1','2026-01-03'),r('a','1','2026-01-04',{distributionHash:'other'}),r('a','1','2026-01-05',{effort:'high'})];
 const gs=aggregate(rows,[q('a'),q('b')],'average');assert.equal(gs[0].total,1.5);assert.equal(gs[0].complete,true);assert.equal(gs[1].answered,1);assert.equal(gs[1].complete,false);assert.equal(gs[0].costUSD,null);
});
test('ungraded and unresolved banks cannot create complete scores; sharing uses same aggregation and escapes content',()=>{
 assert.equal(aggregate([r('a',null,'2026-01-01',{scoreExact:null})],[q('a')])[0].complete,false);
 assert.equal(aggregate([r('a','1','2026-01-01')],[{...q('a'),unresolved:true}]).length,0);
 const rows=[r('a','1/2','2026-01-01',{model:'<script>bad</script>'})];
 const html=report(rows,{title:'<img>',mode:'latest',questions:[q('a'),q('b')]});assert.match(html,/0.50/);assert.match(html,/待补测/);assert.ok(!html.includes('<script>'));assert.match(html,/&lt;img&gt;/);
});

test('shared standings uses report-local provider labels in totals and details',()=>{
 const rows=[r('a',1,1,{provider:'private-account-a',costUSD:1}),r('a',0,2,{provider:'private-account-b',costUSD:2})];
 for(const locale of ['zh-CN','en','ja','ko']){
  const html=report(rows,{title:'Bank',mode:'latest',questions:[q('a')],locale});
  const label=locale==='zh-CN'?'来源':'Source';
  for(const n of [1,2])assert.equal(html.split(label+' '+n).length-1,2);
  assert.ok(!html.includes('private-account'));assert.match(html,/\$1.00/);assert.match(html,/\$2.00/);
 }
});
