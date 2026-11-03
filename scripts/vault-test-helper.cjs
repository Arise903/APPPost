/* Browser tests share the real vault gate: generate the key on first use and unlock later tabs. */
let secret='';
module.exports=async function unlockVault(page){
 await page.waitForFunction(()=>window.ReleaseVault&&document.getElementById('vaultDialog'));
 if(await page.locator('#vaultDialog[open]').count()){
  if(await page.locator('#generateKey').count()){await page.locator('#generateKey').click();await page.waitForSelector('#vaultKeyBanner');secret=await page.evaluate(()=>ReleaseVault.secret());}
  else if(await page.locator('.vault-secret').count()){
   secret=(await page.locator('.vault-secret').innerText()).trim();
   await page.locator('#vaultConfirm').fill(secret);
   await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.locator('#vaultAccept').click()]);
  }else if(await page.locator('#vaultInput').count()){
   await page.locator('#vaultInput').fill(secret);
   await Promise.all([page.waitForNavigation({waitUntil:'load'}),page.locator('#vaultUnlock').click()]);
  }
 }
 await page.waitForFunction(()=>window.ReleaseVault.status()==='unlocked');
 return secret;
};
/* Answer the per-export key confirmation so a real download can finish. */
module.exports.answerExport=async function answerExport(page){
 await page.waitForSelector('#vaultDialog[open]');
 await page.locator('#vaultExportInput').fill(await page.evaluate(()=>window.ReleaseVault.secret()));
 await page.locator('#vaultExportConfirm').click();
 await page.waitForFunction(()=>!document.getElementById('vaultDialog').open);
};
