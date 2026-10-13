import hashlib, json, os, signal, subprocess, time
from pathlib import Path
root = Path.cwd()
out = root / 'web/artifacts/v6-r2'
env = {**os.environ, 'BASE_URL':'http://127.0.0.1:23336', 'PLAYWRIGHT_CHANNEL':'chromium'}
results = []
def mail():
    data = json.loads(subprocess.check_output(['orca','orchestration','check','--terminal','term_df036551-66e4-4470-af80-73a9acfa9299','--json'], text=True))
    if data['result']['messages']:
        print(data['result']['messages'], flush=True)
        raise RuntimeError('Coordinator follow-up requires review')
def run(name, args, extra=None):
    mail()
    with (out / f'{name}.log').open('w') as log:
        result = subprocess.run(args, cwd=root/'web', env={**env, **(extra or {})}, stdout=log, stderr=subprocess.STDOUT)
    results.append({'name':name, 'command':args, 'environment':extra or {}, 'exit':result.returncode})
    (out/'acceptance-results.json').write_text(json.dumps(results, indent=2)+'\n')
    print(results[-1], flush=True)
    mail()
    assert result.returncode == 0, name

def snapshot(i):
    hashes = {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((root/'web/artifacts/v3').glob('*.png'))}
    (out/f'static-{i}.json').write_text(json.dumps(hashes,indent=2)+'\n')
    if i > 1: assert hashes == json.loads((out/'static-1.json').read_text()), f'static capture {i} differs'
    print(f'Static capture {i}: {len(hashes)} PNGs; identical to run 1.', flush=True)

run('suite-1',['bun','run','test']); snapshot(1)
run('suite-2',['bun','run','test']); snapshot(2)
while not (out/'conformance-final.exit').exists(): time.sleep(5)
assert (out/'conformance-final.exit').read_text().strip() == '0', 'conformance failed'
workers = [subprocess.Popen(['timeout','1800','bash','-c','while :; do :; done'], start_new_session=True) for _ in range(64)]
try:
    for i in range(1,4):
        assert all(w.poll() is None for w in workers)
        run(f'countup-load-{i}',['bun','test/review-v6-r2/countup-frames.mjs'],{'THROTTLE_RATES':'1'})
        run(f'choreography-load-{i}',['bun','scripts/choreography-qa.mjs'],{'CHOREOGRAPHY_OUT':f'artifacts/v6-r2/choreography-load-{i}'})
        print('Live busy loops:',sum(w.poll() is None for w in workers),flush=True)
    run('suite-3-load',['bun','run','test']); snapshot(3)
    assert all(w.poll() is None for w in workers)
    print('Suite 3 completed with all 64 busy loops live.',flush=True)
finally:
    for w in workers:
        if w.poll() is None: os.killpg(w.pid,signal.SIGTERM)
    for w in workers: w.wait()
    print('Stopped and reaped all 64 owned busy loops.',flush=True)
for i in range(1,4):
    run(f'countup-throttled-{i}',['bun','test/review-v6-r2/countup-frames.mjs'],{'THROTTLE_RATES':'1,8,20'})
run('visual-4',['bun','scripts/visual-qa.mjs']); snapshot(4)
run('performance-single',['bun','scripts/performance-qa.mjs'],{'PERFORMANCE_REPEATS':'15'})
run('performance-walk',['bun','scripts/performance-qa.mjs','--walk'])
print('Round 2 acceptance pipeline passed.',flush=True)
