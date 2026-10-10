#!/usr/bin/env python3
"""Assert review r2 numeric overflow is accepted and normalized in PostgreSQL."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.request
import uuid

parser = argparse.ArgumentParser()
parser.add_argument('--url', required=True)
parser.add_argument('--project', required=True, type=uuid.UUID)
parser.add_argument('--pg-container', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
review = (root / 'reviews/collector-ingest-r2.md').read_text()
minimal = re.search(r'```json\n(.*?)\n```', review, re.S).group(1)
for token in ['1e400', '-1e400', '1' + '0' * 400, '1e308', '9007199254740993']:
    body = minimal.replace('1e400', token)
    event_id = json.loads(body)['events'][0]['id']
    if token != '1e400':
        new_id = str(uuid.uuid7())
        body = body.replace(event_id, new_id)
        event_id = new_id
    request = urllib.request.Request(
        args.url.rstrip('/') + '/v1/events', data=body.encode(),
        headers={'Authorization': 'Bearer ' + os.environ['SIGNALS_API_KEY'],
                 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request) as response:
        result = json.load(response)
        assert response.status == 202 and result == {'accepted': 1, 'rejected': []}, result
    sql = f"SELECT attrs->'props'->'n' FROM events WHERE project_id='{args.project}' AND id='{event_id}';"
    stored = subprocess.check_output(
        ['docker', 'exec', args.pg_container, 'psql', '-U', 'signals', '-d', 'signals',
         '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], text=True).strip()
    if token in ['1e308', '9007199254740993']:
        expected = 10**308 if token == '1e308' else 9007199254740993
        assert json.loads(stored) == expected, stored
    else:
        assert stored == 'null', stored
    label = token if len(token) < 20 else '401-digit integer'
    print(f'PASS {label}: 202 accepted=1 rejected=[], stored ' +
          ('exact finite number' if token in ['1e308', '9007199254740993'] else 'null'))
print('5/5 acceptance and PostgreSQL storage checks passed')
