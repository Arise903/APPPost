/* Real DOM regression: the workspace key must encrypt everything on disk and gate every export. */
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {answerExport}=require('./vault-test-helper.cjs');const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
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
const dumpIdb=page=>page.evaluate(()=>new Promise((resolve,reject)=>{
 const request=indexedDB.open('release-desk-workspace',2);
 request.onerror=()=>reject(new Error('cannot open'));
 request.onsuccess=()=>{
  const db=request.result,tx=db.transaction(['records','projects','assets'],'readonly'),out={};
  for(const store of ['records','projects','assets']){const get=tx.objectStore(store).getAll();get.onsuccess=()=>{out[store]=get.result;};}
  tx.oncomplete=()=>resolve(JSON.stringify(out));
  tx.onerror=()=>reject(tx.error);
 };
}));
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;try{
 const url='http://127.0.0.1:'+server.address().port+'/APPPost/';
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 const context=await browser.newContext({acceptDownloads:true});
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // First use: the app generates a 24 character key and asks the user to save it.
 await page.goto(url);
 await page.waitForSelector('#generateKey');await page.locator('#generateKey').click();
 await page.waitForFunction(()=>window.ReleaseVault.status()==='unlocked');
 await page.waitForSelector('#vaultKeyBanner');
 const secret=await page.evaluate(()=>window.ReleaseVault.secret());
 assert.match(secret,/^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/,'密钥为 24 位分组随机串');
 // A project saved afterwards must be sealed on disk.
 await page.evaluate(()=>PagesStore.create({name:'机密项目配置',document:'# T\n## C\n- [ ] 一项 <!-- task:only -->\n',requireGuideConfirmation:false}));
 await page.waitForTimeout(800);
 assert.equal(await page.evaluate(()=>PagesStore.list().length),1);
 const sealed=await dumpIdb(page);
 assert.match(sealed,/release-desk-encrypted\/v1/,'落盘必须是密文信封');
 assert.doesNotMatch(sealed,/机密项目配置/,'磁盘里不能出现项目名明文');
 assert.doesNotMatch(sealed,/task:only/,'磁盘里不能出现清单正文');
 assert.doesNotMatch(sealed,/Adjust appToken/,'磁盘里不能出现配置字段名');
 // A fresh tab has no session key and must ask before showing anything.
 const other=await context.newPage();
 await other.goto(url);await other.waitForSelector('#vaultDialog[open]');
 await other.locator('#vaultInput').fill('WRONG-KEY-WRONG-KEY-WRONG-KEY');await other.locator('#vaultUnlock').click();
 await other.waitForFunction(()=>document.getElementById('vaultDialogStatus')?.textContent.includes('密钥不正确'));
 await other.locator('#vaultInput').fill(secret);
 await Promise.all([other.waitForNavigation({waitUntil:'load'}),other.locator('#vaultUnlock').click()]);
 await other.waitForFunction(()=>window.ReleaseVault.status()==='unlocked');
 await other.waitForSelector('.project-card');
 assert.match(await other.locator('.project-card').first().innerText(),/机密项目配置/,'解锁后能看到项目');
 await other.close();
 // Every export asks for the key again: a wrong key produces no file.
 page.evaluate(()=>PagesStore.download('release-desk-export.json','{}'));
 await page.waitForSelector('#vaultDialog[open]');
 await page.locator('#vaultExportInput').fill('WRONG-KEY-WRONG-KEY-WRONG-KEY');
 await page.locator('#vaultExportConfirm').click();
 await page.waitForFunction(()=>[document.getElementById('toastMsg')?.textContent,document.getElementById('notice')?.textContent].some(text=>text&&text.includes('密钥不匹配')));
 assert.equal(await page.evaluate(()=>document.getElementById('vaultDialog').open),false);
 const downloading=page.waitForEvent('download');
 page.evaluate(()=>PagesStore.download('release-desk-export.json','{}'));
 await answerExport(page);
 const download=await downloading;
 assert.match(download.suggestedFilename(),/release-desk-export\.json/,'密钥正确时允许导出');
 assert.deepEqual(errors,[]);
 await context.close();
 console.log('Vault passed: generated key, sealed storage, unlock gate, wrong-key rejection and export authorization.');
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
