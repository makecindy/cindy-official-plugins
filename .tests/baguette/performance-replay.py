#!/usr/bin/env python3
"""Real toolchain A/B replay. Inputs and raw results stay outside the repository.

config: baseline, candidate (plugin directories), root (dedicated state directory
containing replay-only), udid, appPath, bundleId, output. Never discovers, erases
or deletes devices. --first uninstalls only from the explicitly dedicated set.
All subprocess calls use argv; this does not run a model or an Agent task.
"""
import argparse
import json
import pathlib
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument('config')
parser.add_argument('--first', action='store_true')
parser.add_argument('--rounds', type=int, default=5)
parser.add_argument('--case', choices=['install', 'info', 'touch'], default='info')
args = parser.parse_args()
config = json.loads(pathlib.Path(args.config).read_text())
root = pathlib.Path(config['root'])
assert (root / 'replay-only').is_file(), 'Requires a dedicated replay set'
out = pathlib.Path(config['output']); out.mkdir(parents=True, exist_ok=True)
adapter = pathlib.Path(__file__).with_name('replay-worker.cjs')
records = []


class Worker:
    def __init__(self, label):
        self.label = label
        self.process = subprocess.Popen(['node', str(adapter), config[label], str(root)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
            stderr=(out / (label + '.stderr')).open('a'))
        self.counter = 0

    def call(self, method, **params):
        params['udid'] = config['udid']
        self.counter += 1
        self.process.stdin.write(json.dumps(dict(id=self.counter, method=method, params=params)) + '\n')
        self.process.stdin.flush()
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError('Replay worker exited')
        result = json.loads(line)
        records.append(dict(version=self.label, round=round_no, case=args.case,
            phase=phase, method=method, params=params, **result))
        (out / 'calls.json').write_text(json.dumps(records, indent=2))
        print(self.label, round_no, phase, method, round(result['ms']), result.get('result', {}).get('state'), flush=True)
        if not result['ok']:
            raise RuntimeError(str(result.get('error')))
        return result['result']

    def completed(self, action, **params):
        result = self.call('app', action=action, **params)
        for _ in range(30):
            if result.get('state') != 'running':
                break
            result = self.call('app', action='install_status', job=result['job'], wait=85)
        assert result.get('state') != 'running', 'Job did not finish'
        return result

    def close(self):
        self.process.stdin.close(); self.process.wait(timeout=20)


workers = {label: Worker(label) for label in ['baseline', 'candidate']}
round_no = 0
phase = 'prepare'
try:
    for round_no in range(1, args.rounds + 1):
        order = ['baseline', 'candidate'] if round_no % 2 else ['candidate', 'baseline']
        for label in order:
            w = workers[label]; phase = 'prepare'
            if args.case == 'install' and args.first:
                w.call('app', action='uninstall', bundleId=config['bundleId'])
            elif args.case == 'install' or (args.case == 'info' and round_no == 1):
                # Receipt and OS caches are explicitly warm, both revisions get
                # the same full verification preparation (included in raw data).
                proof = w.completed('info', appPath=config['appPath'], wait=85,
                    **({'verify': 'full'} if label == 'candidate' else {}))
                assert proof.get('matchesLocal') is True, proof
            if args.case == 'touch':
                w.call('app', action='launch', bundleId=config['bundleId'], showViewer=False,
                    env=config.get('env', {}), arguments=config.get('arguments', []))
                initial = w.call('wait_for', text=config['initialText'], timeout=30)
                assert initial.get('met') is True, initial
                w.call('screenshot')
            phase = 'measure'
            started = time.monotonic()
            if args.case == 'install':
                w.completed('install', appPath=config['appPath'], wait=1)
                proof = w.completed('info', appPath=config['appPath'], wait=85)
                assert proof.get('matchesLocal') is True, proof
            elif args.case == 'info':
                proof = w.completed('info', appPath=config['appPath'], wait=85)
                assert proof.get('matchesLocal') is True, proof
            else:
                result = w.call('tap', **config['tap'])
                assert result.get('execution') == 'executed', result
                assert result.get('screenshot', {}).get('path'), result
                # Input delivery and a frame alone do not establish the goal.
                goal = w.call('wait_for', text=config['targetText'], timeout=15)
                assert goal.get('met') is True, goal
            records.append(dict(version=label, round=round_no, case=args.case,
                phase='total', ms=(time.monotonic() - started) * 1000, goalMet=True))
            (out / 'calls.json').write_text(json.dumps(records, indent=2))
finally:
    for w in workers.values():
        w.close()
