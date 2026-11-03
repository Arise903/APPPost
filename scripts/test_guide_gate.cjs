const unlockVault=require('./vault-test-helper.cjs');
/* Real DOM regression: visibility must remain correct on initial load and every rebuild. */
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../docs');
const server=http.createServer((req,res)=>{
 try{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(!name.startsWith('/APPPost/')){res.writeHead(404).end();return;}
  const target=path.resolve(root,name.slice('/APPPost/'.length)||'index.html');
  if(!target.startsWith(root+path.sep)||!fs.statSync(target).isFile()){res.writeHead(404).end();return;}
  const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json'};
  res.setHeader('Content-Type',(mime[path.extname(target)]||'application/octet-stream')+'; charset=utf-8');res.end(fs.readFileSync(target));
 }catch(_){res.writeHead(404).end();}
});

(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;try{
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 const page=await browser.newPage(),url='http://127.0.0.1:'+server.address().port+'/APPPost/',errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await unlockVault(page);await page.waitForFunction(()=>document.getElementById('projectCount').textContent==='0');

 const ids=await page.evaluate(async()=>{const ids=[];for(const t of PagesStore.listTemplates().filter(t=>t.builtin))ids.push(await PagesStore.create({name:t.name,document:t.document,features:t.features}));ids.push(await PagesStore.create({name:'Original',document:PAGES_DATA.document}));ids.push(await PagesStore.create({name:'Imported custom',document:'# Custom\n## Checks\n- [x] 已有进度 <!-- task:existing -->\n- [ ] 未完成 <!-- task:todo -->\n',review:{guideAcknowledged:'on',release:{},items:{},history:[]}}));return ids;});
 for(const id of ids){
  await page.evaluate(id=>{localStorage.setItem('app-guide-ack','1');localStorage.setItem('app-guide-ack:pages:'+id,'1');},id);
  await page.goto(url+'board.html?id='+id);await page.waitForFunction(()=>typeof online!=='undefined'&&online);assert.equal(await page.evaluate(()=>gateDone),false);assert.equal(await page.locator('#gateBar').isVisible(),true);assert.equal(await page.locator('#aiReviewExport').isDisabled(),true);
  const blocked=await page.evaluate(async()=>{const p=PagesStore.get(PagesStore.projectId()),d=PagesStore.payload(p),task=d.items.find(i=>!i.gate);const r=await fetch('/api/write',{method:'POST',body:JSON.stringify({revision:String(p.version),states:{[task.id]:'done'}})});return {status:r.status,task:task.id,old:task.state};});assert.equal(blocked.status,403);
  assert.equal(await page.locator('#list li.item:not(.gateitem)').evaluateAll(rows=>rows.every(row=>row.dataset.gateLocked==='1')),true);
  await page.goto(url+'guide.html?id='+id);await page.waitForFunction(()=>typeof document.getElementById('ack').onclick==='function');await page.locator('#ack').click();await page.waitForURL(/board.html/);await page.waitForFunction(()=>typeof online!=='undefined'&&online&&gateDone);assert.equal(await page.locator('#gateBar').isVisible(),false);
  await page.goto(url+'guide.html?id='+id);page.once('dialog',d=>d.accept());await page.locator('#unack').click();await page.waitForURL(/board.html/);await page.waitForFunction(()=>typeof online!=='undefined'&&online);assert.equal(await page.evaluate(()=>gateDone),false);assert.equal(await page.locator('#gateBar').isVisible(),true);assert.equal(await page.evaluate(task=>PagesStore.payload(PagesStore.get(PagesStore.projectId())).items.find(i=>i.id===task).state,blocked.task),blocked.old);
  await page.reload();await page.waitForFunction(()=>typeof online!=='undefined'&&online);assert.equal(await page.evaluate(()=>gateDone),false);
 }
 assert.deepEqual(errors,[]);console.log('Guide gate passed: every built-in template, original checklist and imported progress; no cross-project/local-cache bypass; explicit confirmation, cancellation and reload preserve project progress.');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
