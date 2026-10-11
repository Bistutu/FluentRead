from pathlib import Path
import subprocess,sys,os,json,datetime,hashlib,time,shutil
repo=Path('<CW_WORKSPACE>/FluentRead-pr906-main-merge-20261010')
evidence=repo.parent/'pr906-gf-post-maintenance-20261011'
name=sys.argv[1];args=sys.argv[2:]
assert name.replace('-','').isalnum() and args
pnpm=Path('<CW_PNPM9_TEMP>/package/bin/pnpm.cjs');assert pnpm.is_file()
def snapshot():
 paths=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=repo).split(b'\0')
 hashes={p.decode():hashlib.sha256((repo/p.decode()).read_bytes()).hexdigest() for p in paths if p and (repo/p.decode()).is_file()}
 digest=hashlib.sha256(json.dumps(hashes,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 return {'trackedFiles':hashes,'sha256':digest}
before=snapshot();(evidence/(name+'-source.json')).write_text(json.dumps(before,indent=2)+'\n')
patch=subprocess.check_output(['git','diff','--binary','HEAD'],cwd=repo);(evidence/(name+'.patch')).write_bytes(patch)
command=['node',str(repo/'scripts/testing/run-resource-safe.mjs'),'--cpu-target','60','--max-workers','1','--concurrency','1','--','node',str(pnpm),*args]
env=os.environ.copy();env['PATH']='<CW_PNPM9_SHIM>:'+env.get('PATH','');env['FLUENTREAD_TEST_CPU_TARGET']='60';env['FLUENTREAD_TEST_MAX_WORKERS']='1';env['FLUENTREAD_TEST_CONCURRENCY']='1';env['CI']='1'
record={'name':name,'startedAtUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'args':args,'baselineCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),'sourceSnapshotSha256':before['sha256'],'patchSha256':hashlib.sha256(patch).hexdigest(),'cpuTargetPercent':60,'workers':1,'concurrency':1}
record['helperFileInputs']={str(Path(arg).resolve()):hashlib.sha256(Path(arg).read_bytes()).hexdigest() for arg in args if Path(arg).is_file() and Path(arg).suffix in ['.mjs','.js','.cjs','.py']}
record['selectedEnvironment']={key:env.get(key) for key in ['TZ','CI','FLUENTREAD_USERSCRIPT_GREASYFORK_SOURCE','FLUENTREAD_USERSCRIPT_STANDALONE','FLUENTREAD_USERSCRIPT_VENDOR_URL','FLUENTREAD_USERSCRIPT_DATA_URL']}
log=evidence/(name+'.log.txt');timer=evidence/(name+'-time.txt');assert not log.exists()
start=time.monotonic()
with log.open('w') as f:result=subprocess.run(['/usr/bin/time','-v','-o',str(timer),*command],cwd=repo,env=env,stdout=f,stderr=subprocess.STDOUT)
after=snapshot()
changed=sorted(key for key in before['trackedFiles'].keys()|after['trackedFiles'].keys() if before['trackedFiles'].get(key)!=after['trackedFiles'].get(key))
prepare=args==['exec','node','scripts/build-userscript-greasyfork.mjs','--prepare-resources']
if prepare:
 assert set(changed)<=set(['userscript/resources/fluentread-vendor.v1.js','userscript/resources/fluentread-data.v1.js']),'Prepare changed unexpected files'
 record['expectedResourceWrites']=changed;record['afterSourceSnapshotSha256']=after['sha256'];record['resourceFileBinding']={key:{'before':before['trackedFiles'].get(key),'after':after['trackedFiles'].get(key)} for key in changed}
else:assert before==after,'Tracked source changed during stage'
record.update({'finishedAtUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'wallSeconds':round(time.monotonic()-start,3),'exitCode':result.returncode,'sourceUnchangedDuringStage':before==after,'log':log.name,'logSha256':hashlib.sha256(log.read_bytes()).hexdigest(),'timeFileSha256':hashlib.sha256(timer.read_bytes()).hexdigest()})
if args[0] in ['build:userscript:standalone','build:userscript'] and result.returncode==0:
 mode='userscript-standalone' if 'standalone' in args[0] else 'userscript'
 artifact=repo/'.output'/mode/'fluent-read.user.js';data=artifact.read_bytes();shutil.copyfile(artifact,evidence/(name+'.user.js'))
 verifier=repo/'scripts'/('verify-userscript-standalone-build.mjs' if mode.endswith('standalone') else 'verify-userscript-build.mjs')
 vr=subprocess.run(['node',str(verifier)],cwd=repo,capture_output=True,text=True)
 (evidence/(name+'-verifier.log.txt')).write_text(vr.stdout+vr.stderr)
 record['artifact']={'mode':mode,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'verifierExitCode':vr.returncode,'originalBudget':3600000 if mode.endswith('standalone') else 2025000}
p=evidence/'STAGES.json';all=json.loads(p.read_text()) if p.exists() else [];all.append(record);p.write_text(json.dumps(all,indent=2)+'\n')
print(json.dumps(record));print(log.read_text()[-2600:]);sys.exit(result.returncode)
