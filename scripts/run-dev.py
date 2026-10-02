"""Read the Compose-compatible dotenv file without executing it as shell code."""
import json
import os
from pathlib import Path

env_file = Path('.env')
if env_file.exists():
    for line in env_file.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, _, value = line.partition('=')
        value = value.strip()
        if value.startswith('"'):
            value = json.loads(value)
        elif value.startswith("'") and value.endswith("'"):
            value = value[1:-1]
        os.environ[key.strip()] = value.replace('$$', '$')
os.execvp('cargo', ['cargo', 'run', '--locked', '--bin', 'signals', '--', 'serve'])
