#!/usr/bin/env python3
import argparse, os, subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--compose',type=Path,default=Path(__file__).resolve().parents[1]/'docker/qa.compose.yml');p.add_argument('--project',default='signals-qa');p.add_argument('--env-file',type=Path,default=Path('/tmp/signals-bench.env'));a=p.parse_args()
assert a.project.startswith('signals-') and 'qa' in a.project
values=dict(line.split('=',1) for line in a.env_file.read_text().splitlines() if line and not line.startswith('#'))
subprocess.run(['docker','compose','-p',a.project,'-f',str(a.compose),'run','-T','--rm','--user',str(os.getuid()),'-e','SIGNALS_API_KEY','-e','SIGNALS_URL','k6','run','/bench/ingest.js','--summary-export','/bench/artifacts/k6.json'],env={**os.environ,**values},check=True)
