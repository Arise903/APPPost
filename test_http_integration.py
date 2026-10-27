import sys
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
import checklist_tool as c
import tempfile, threading, json, http.client
from pathlib import Path
def main():
    with tempfile.TemporaryDirectory() as tmp:
        md=Path(tmp)/'test.md'; md.write_text('# Demo\n\n## Tasks\n- [ ] First\n- [ ] Second\n')
        c.STATE_FILE=Path(tmp)/'generation.json'
        srv=c.ThreadingHTTPServer(('127.0.0.1',0),c.make_handler());srv.md_path=md;srv.html_path=md.with_suffix('.html')
        thread=threading.Thread(target=srv.serve_forever,daemon=True);thread.start()
        def req(path,body=None,origin=None):
            conn=http.client.HTTPConnection('127.0.0.1',srv.server_port)
            headers={'Content-Type':'application/json'}
            if origin: headers['Origin']=origin
            conn.request('GET' if body is None else 'POST',path, None if body is None else json.dumps(body),headers)
            response=conn.getresponse(); raw=response.read();conn.close()
            return response.status,json.loads(raw) if path.startswith('/api/') else raw
        try:
            status,data=req('/api/list'); assert status==200
            rev=data['revision']; item=data['items'][0]['id']
            status,saved=req('/api/write',{'revision':rev,'states':{item:'done'}});assert status==200
            assert req('/api/write',{'revision':rev,'states':{item:'todo'}})[0]==409
            assert req('/api/clear',{'revision':rev})[0]==409
            assert req('/api/write',{'revision':saved['revision'],'states':{}},'https://example.com')[0]==403
            status,review=req('/api/review',{'revision':saved['revision'],'review':{'release':{'version':'1'},'items':{item:{'reason':'verified','notes':'OK','evidence':'screen.png'}},'history':[]}});assert status==200
            status,backups=req('/api/backups',{});assert status==200 and backups['backups']
            assert req('/api/restore',{'revision':review['revision'],'name':'../../x'})[0]==400
            status,restored=req('/api/restore',{'revision':review['revision'],'name':backups['backups'][0]});assert status==200
            assert restored['items'][0]['state']=='todo'
            assert req('/')[0]==200
            assert req('/api/write',[])[0]==400
            print('HTTP integration: save, stale-write conflict, stale-clear conflict, cross-origin rejection, review, backups, restore traversal, restore, dynamic HTML, invalid payload: 10 passed')
        finally: srv.shutdown();srv.server_close()

if __name__ == "__main__":
    main()
