"""
PlatformIO pre-build script: load build-time configuration from a `.env`
file in the project root and expose selected values to the firmware.

Supported keys (see .env.example):
  OTA_SERVER_URL        Full URL of the OTA release-metadata endpoint, e.g.
                        https://crosspoint-ota.example.workers.dev/releases/latest
                        Becomes the firmware's default "OTA Server URL" setting.
                        Leave unset to default to the upstream GitHub releases API.
  CROSSPOINT_BUILD_SHA  Optional commit SHA used by git_branch.py for CI version strings.

Values already present in the process environment (e.g. set by CI) take
precedence over the `.env` file, so CI never needs the file at all.
"""

import os
import sys


def warn(msg):
    print(f'WARNING [load_env.py]: {msg}', file=sys.stderr)


def parse_dotenv(path):
    values = {}
    try:
        with open(path, encoding='utf-8') as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                key, _, value = line.partition('=')
                key = key.strip()
                if key.startswith('export '):
                    key = key[len('export '):].strip()
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                    value = value[1:-1]
                values[key] = value
    except FileNotFoundError:
        pass
    except OSError as exc:
        warn(f'could not read {path}: {exc}')
    return values


def load_env(env):
    project_dir = env['PROJECT_DIR']
    for key, value in parse_dotenv(os.path.join(project_dir, '.env')).items():
        os.environ.setdefault(key, value)

    ota_url = os.environ.get('OTA_SERVER_URL', '').strip()
    if ota_url:
        if '"' in ota_url or '\\' in ota_url:
            warn('OTA_SERVER_URL contains quotes or backslashes; ignoring it')
        else:
            env.Append(CPPDEFINES=[('CROSSPOINT_OTA_SERVER_URL', f'\\"{ota_url}\\"')])
            print(f'CrossPoint default OTA server: {ota_url}')
    else:
        print('CrossPoint default OTA server: upstream GitHub releases (OTA_SERVER_URL not set)')


# PlatformIO/SCons entry point — Import and env are SCons builtins injected at runtime.
# When run directly with Python the logic is exercised against a fake env.
try:
    Import('env')       # noqa: F821  # type: ignore[name-defined]
    load_env(env)       # noqa: F821  # type: ignore[name-defined]
except NameError:
    class _Env(dict):
        def Append(self, **kw): print(kw)

    _project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    load_env(_Env({'PIOENV': 'default', 'PROJECT_DIR': _project_dir}))
