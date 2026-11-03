(async function(){await PagesStore.initialize();
'use strict';
const id=PagesStore.projectId();let p;
try{p=PagesStore.get(id);document.getElementById('back').href='board.html?id='+encodeURIComponent(id);const guide=PagesStore.parse(p.document).sections.filter(s=>s.guide_only).flatMap(s=>s.blocks).map(b=>b.type==='table'?(b.rows||[]).map(row=>row.join(' | ')).join('\n'):b.title||b.text||(b.lines||[]).join('\n')).filter(text=>String(text).trim()).join('\n\n').trim();document.getElementById('projectGuide').textContent=guide;document.getElementById('projectGuideSection').hidden=!guide;}catch(e){document.getElementById('message').textContent=e.message;}
async function confirmRead(done){try{p=PagesStore.get(id);const gate=PagesStore.payload(p).gateId;await PagesStore.mutate(id,String(p.version),done?'ack':'unack',project=>{if(gate)project.document=PagesStore.apply(project.document,{[gate]:done?'done':'skip'});project.review.guideAcknowledged=done?'on':'off';});const key='app-guide-ack:pages:'+id;if(done)localStorage.setItem(key,'1');else localStorage.removeItem(key);location.href='board.html?id='+encodeURIComponent(id);}catch(e){document.getElementById('message').textContent=e.message;}}
document.getElementById('ack').onclick=()=>confirmRead(true);document.getElementById('unack').onclick=()=>{if(confirm('取消本项目的阅读确认？'))confirmRead(false);};

})().catch(error=>document.getElementById('message').textContent=error.message);
