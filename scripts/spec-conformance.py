#!/usr/bin/env python3
"""Exercise the pinned specification fixtures against a running collector."""
import argparse
import datetime
import difflib
import gzip
import json
import os
from pathlib import Path
import urllib.error
import urllib.request


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--wall-clock-smoke', action='store_true', help='Rewrite tool-called timestamps to now and verify the normal clock')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1] / 'spec' / 'fixtures'
    key = os.environ['SIGNALS_API_KEY']
    failures = 0
    for encoding in ('identity', 'gzip'):
        for category in ('valid', 'invalid'):
            fixtures = sorted(p for p in (root / category).iterdir() if p.suffix in ('.json', '.ndjson') and not p.name.endswith('.expected.json'))
            if args.wall_clock_smoke:
                fixtures = [root / 'valid' / 'tool-called.json'] if category == 'valid' else []
            passed = 0
            for fixture in fixtures:
                body = fixture.read_bytes()
                if args.wall_clock_smoke:
                    batch = json.loads(body)
                    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
                    batch['sent_at'] = now
                    for event in batch['events']:
                        event['ts'] = now
                    body = json.dumps(batch).encode()
                if category == 'valid':
                    count = len(json.loads(body)['events']) if fixture.suffix == '.json' else len([line for line in body.decode().split('\n') if line.strip(' \t\r\n\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff')]) - 1
                    expected = {'status': 202, 'accepted': count, 'rejected': []}
                else:
                    expected = json.loads(fixture.with_suffix('.expected.json').read_text())
                request = urllib.request.Request(args.url.rstrip('/') + '/v1/events', gzip.compress(body) if encoding == 'gzip' else body, headers={
                    'Authorization': 'Bearer ' + key,
                    'Content-Type': 'application/x-ndjson' if fixture.suffix == '.ndjson' else 'application/json',
                    'Content-Encoding': encoding,
                })
                try:
                    response = urllib.request.urlopen(request, timeout=30)
                except urllib.error.HTTPError as error:
                    response = error
                with response:
                    payload = response.read()
                    try:
                        data = json.loads(payload)
                    except ValueError:
                        data = {'non_json_body': payload.decode(errors='replace')}
                    actual = {'status': response.status, **{k: data.get(k) for k in ('error', 'accepted', 'rejected') if k in expected}}
                shape_ok = set(data) == {'accepted', 'rejected'} if response.status == 202 else isinstance(data.get('message'), str)
                if actual == expected and shape_ok:
                    passed += 1
                else:
                    failures += 1
                    print(f'FAIL {encoding} {category}/{fixture.name}')
                    print('\n'.join(difflib.unified_diff(json.dumps(expected, indent=2).splitlines(), json.dumps(actual, indent=2).splitlines(), fromfile='expected', tofile='actual')))
                    if not shape_ok:
                        print('Unexpected response shape:', data)
            print(f'{encoding}: {passed}/{len(fixtures)} {category} fixtures matched')
    return int(failures != 0)


if __name__ == '__main__':
    raise SystemExit(run())
