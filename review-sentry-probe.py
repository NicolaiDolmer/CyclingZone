import json,subprocess,sys
api='C:/Users/Nicolai/.codex/plugins/cache/openai-curated-remote/sentry/0.1.2/skills/sentry/scripts/sentry_api.py'
args=sys.argv[1:]
p=subprocess.run([sys.executable,api,'--org','cycling-zone','--project','cyclingzone',*args],capture_output=True,text=True)
if p.returncode:
 print(p.stderr);sys.exit(p.returncode)
data=json.loads(p.stdout)
def pick(d):
 keys=['id','eventID','eventId','dateCreated','dateReceived','timestamp','title','message','lastSeen','firstSeen','count','shortId','permalink','context','extra']
 result={k:d[k] for k in keys if k in d}
 result['tags']=[t for t in d.get('tags',[]) if t.get('key') in ['environment','release','check','server_name']]
 result['runtime']=d.get('contexts',{}).get('runtime',{})
 for e in d.get('entries',[]):
  if e.get('type')=='exception':
   result['exceptions']=[{'type':v.get('type'),'value':v.get('value'),'frames':[{'filename':f.get('filename'),'function':f.get('function'),'lineNo':f.get('lineNo')} for f in v.get('stacktrace',{}).get('frames',[]) if 'stallWatchdog' in (f.get('filename') or '')]} for v in e.get('data',{}).get('values',[])]
  if e.get('type')=='breadcrumbs':
   result['breadcrumbs']=[{'timestamp':v.get('timestamp'),'message':v.get('message'),'data':v.get('data')} for v in e.get('data',{}).get('values',[]) if any(k in str(v) for k in ['heartbeat','ranking_refresh_work_state','ranking-refresh','refreshed_at'])]
 return result
print(json.dumps([pick(d) for d in data] if isinstance(data,list) else pick(data),indent=2))
