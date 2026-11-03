/* Workspace vault: one browser-generated key encrypts everything the app stores,
   exports and syncs. The key is never written to disk in clear text; losing it
   means the workspace cannot be recovered. */
(function(root){
'use strict';
const FORMAT='release-desk-encrypted/v1',ITERATIONS=310000;
const VAULT_KEY='release-desk-vault:v1',SESSION_KEY='release-desk-vault-session:v1';
const ALPHABET='ABCDEFGHJKMNPQRSTVWXYZ23456789'; // Crockford base32 without I/L/O/U/0/1
const VERIFIER='release-desk vault verifier';
let cachedKey=null,cachedSecret='';
const encode=bytes=>{let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary);};
const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
function randomSecret(length=24){
 const bytes=crypto.getRandomValues(new Uint8Array(length));
 let out='';for(let i=0;i<length;i++)out+=ALPHABET[bytes[i]%ALPHABET.length];
 return out.match(/.{1,4}/g).join('-');
}
function normalizeSecret(value){return String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');}
async function derive(secret,salt){
 const source=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'},source,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
const meta=()=>{try{return JSON.parse(localStorage.getItem(VAULT_KEY)||'null')||null;}catch(_){return null;}};
function rememberSecret(secret){cachedSecret=normalizeSecret(secret);try{sessionStorage.setItem(SESSION_KEY,cachedSecret);}catch(_){}}
const sessionSecret=()=>{try{return sessionStorage.getItem(SESSION_KEY)||'';}catch(_){return '';}};
async function keyFor(secret,salt){
 if(cachedKey&&cachedSecret&&cachedSecret===normalizeSecret(secret)&&cachedKey.salt===salt)return cachedKey.key;
 const key=await derive(normalizeSecret(secret),salt);
 cachedKey={salt,key};cachedSecret=normalizeSecret(secret);
 return key;
}
async function encryptWith(key,value){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(value)));
 return {format:FORMAT,algorithm:'AES-256-GCM',kdf:'PBKDF2-SHA256',iterations:ITERATIONS,iv:encode(iv),ciphertext:encode(new Uint8Array(cipher))};
}
async function decryptWith(key,envelope){
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(envelope.iv)},key,decode(envelope.ciphertext));
 return JSON.parse(new TextDecoder().decode(plain));
}
function sanitize(envelope){
 const {salt,...rest}=envelope||{};
 return rest;
}
const api={
 FORMAT,
 exportResolver:null,
 status(){return meta()?(sessionSecret()?'unlocked':'locked'):'uninitialized';},
 secret(){const raw=sessionSecret();return raw?raw.match(/.{1,4}/g).join('-'):'';},
 /* 首次使用：生成密钥并立即加密落盘。返回密钥原文，调用方负责展示与要求用户保存。 */
 async create(input){
  if(meta())throw Error('加密已初始化，禁止覆盖现有密钥；请使用解锁或恢复备份');
  const secret=input?normalizeSecret(input):randomSecret(24),salt=crypto.getRandomValues(new Uint8Array(16));
  if(!normalizeSecret(secret))throw Error('密钥必须包含字母或数字');
  const key=await derive(normalizeSecret(secret),salt);
  const verifier=await encryptWith(key,{claim:VERIFIER,at:Date.now()});
  localStorage.setItem(VAULT_KEY,JSON.stringify({format:FORMAT,salt:encode(salt),iterations:ITERATIONS,verifier:sanitize(verifier),createdAt:Date.now()}));
  cachedKey={salt,key};rememberSecret(secret);
  return secret;
 },
 async exportFile(value){const stored=meta();return {...await this.encrypt(value),salt:stored.salt};},
 async importFile(value,input){
  if(value?.format!==FORMAT||!value.salt||value.algorithm!=='AES-256-GCM'||value.kdf!=='PBKDF2-SHA256'||value.iterations!==ITERATIONS)throw Error('不支持的加密备份格式');
  // 旧云端备份使用原始口令；新备份使用规范化密钥，兼容两种派生方式。
  for(const secret of [...new Set([normalizeSecret(input),String(input||'')])]){
   try{return await decryptWith(await derive(secret,decode(value.salt)),value);}catch(_){}
  }
  throw Error('导入密钥不正确或文件已损坏');
 },
 async unlock(input){
  const stored=meta();if(!stored)throw Error('此浏览器还没有生成密钥，请先初始化加密。');
  const salt=decode(stored.salt),secret=normalizeSecret(input),key=await derive(secret,salt);
  try{const claim=await decryptWith(key,{...stored.verifier,salt:undefined});if(claim?.claim!==VERIFIER)throw Error('bad');}
  catch(_){throw Error('密钥不正确，无法解密本机数据。');}
  cachedKey={salt,key};rememberSecret(secret);
  return true;
 },
 lock(){cachedKey=null;cachedSecret='';try{sessionStorage.removeItem(SESSION_KEY);}catch(_){}},
 async encrypt(value){
  const stored=meta();if(!stored)throw Error('加密未初始化');
  const salt=decode(stored.salt),secret=sessionSecret();
  if(!secret)throw Error('本机数据已加密，请先输入密钥解锁。');
  const key=await keyFor(secret,salt);
  return sanitize(await encryptWith(key,value));
 },
 async decrypt(envelope){
  if(!envelope||envelope.format!==FORMAT)return envelope;
  const stored=meta();if(!stored)throw Error('加密未初始化，无法解密本机数据。');
  const secret=sessionSecret();if(!secret)throw Error('本机数据已加密，请先输入密钥解锁。');
  const key=await keyFor(secret,decode(stored.salt));
  try{return await decryptWith(key,envelope);}
  catch(_){throw Error('解密失败：密钥不正确或本机数据已损坏。');}
 },
 /* 导出、同步等敏感操作：要求再次输入密钥，避免解锁状态下被他人一键带走数据。 */
 authorize(action='执行此操作'){
  if(this.status()!=='unlocked')throw Error('请先输入密钥解锁。');
  return new Promise((resolve,reject)=>{
   api.exportResolver={action,resolve,reject};
   document.dispatchEvent(new CustomEvent('vault-authorize-request'));
  });
 },
 resolveExport(answer){
  const pending=api.exportResolver;if(!pending)return false;api.exportResolver=null;
  if(answer===null||answer===undefined){pending.reject(Object.assign(Error('已取消，未导出任何数据。'),{cancelled:true}));return true;}
  if(normalizeSecret(answer)!==normalizeSecret(sessionSecret())){pending.reject(new Error('密钥不匹配，未导出任何数据。'));return true;}
  pending.resolve(true);return true;
 }
};
root.ReleaseVault=api;
})(typeof window==='undefined'?globalThis:window);
