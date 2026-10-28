#!/usr/bin/env python3
"""Alternating real-touch/observation replay on an explicitly dedicated device.

Same private config as performance-replay.py, plus env, arguments, initialText,
targetText and tap. Capture/viewer faults affect only the observation transport,
never App functions or native input. Resets happen between independent trials
(or native prepare/cleanup steps with keepRunning=true for a restored scene);
recovery within a trial must keep the same App PID and never repeat input.
"""
import argparse
import json
import os
import pathlib
import subprocess
import time

p = argparse.ArgumentParser()
p.add_argument('config')
p.add_argument('--mode', choices=['touch', 'capture', 'viewer'], required=True)
p.add_argument('--rounds', type=int, default=5)
p.add_argument('--start-round', type=int, default=1)
p.add_argument('--only-version', choices=['baseline', 'candidate'])
a = p.parse_args()
c = json.loads(pathlib.Path(a.config).read_text())
root = pathlib.Path(c['root'])
assert (root / 'replay-only').is_file()
out = pathlib.Path(c['output']); out.mkdir(parents=True, exist_ok=True)
rows = []
workers = {}
for label in ['baseline', 'candidate']:
    workers[label] = subprocess.Popen(['node', str(pathlib.Path(__file__).with_name('replay-worker.cjs')),
        c[label], str(root)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
        stderr=(out / (label + '.stderr')).open('a'))


def save():
    (out / 'calls.json').write_text(json.dumps(rows, indent=2))


def call(method, fault=None, _allow_failure=False, **params):
    params['udid'] = c['udid']
    w = workers[label]
    w.stdin.write(json.dumps(dict(id=len(rows), method=method, params=params, fault=fault)) + '\n')
    w.stdin.flush()
    r = json.loads(w.stdout.readline())
    rows.append(dict(version=label, round=round_no, case=a.mode, phase=phase,
        method=method, params=params, fault=fault, **r)); save()
    print(label, round_no, phase, method, round(r['ms']), r.get('ok'), flush=True)
    if not _allow_failure:
        assert r['ok'], r
    return r


try:
    for round_no in range(a.start_round, a.start_round + a.rounds):
        for label in (['baseline', 'candidate'] if round_no % 2 else ['candidate', 'baseline']):
            if a.only_version and label != a.only_version:
                continue
            phase = 'prepare'
            preparation_retries = 0
            if c.get('keepRunning', False):
                # The restored scene is already running. Even a non-relaunching
                # launch request can reactivate it; preparation needs no launch.
                pid = c['appPid']; os.kill(pid, 0)
                rows.append(dict(version=label, round=round_no, case=a.mode, phase='begin', appPid=pid)); save()
            else:
                launched = call('app', action='launch', bundleId=c['bundleId'], showViewer=False,
                    env=c.get('env', {}), arguments=c.get('arguments', []))['result']
                pid = int(launched['stdout'].strip().rsplit(':', 1)[1])
            for step in c.get('prepareSteps', []):
                prepared = call(step['method'], _allow_failure=True, **step['params'])
                if not prepared['ok']:
                    # Never retry unknown/executed input. Confirm geometry by
                    # observation before one retry of a rejected preparation.
                    assert prepared['error'].get('execution') == 'not_executed', prepared
                    assert prepared['error'].get('code') in ['SCREEN_UNAVAILABLE', 'SCREEN_CHANGED'], prepared
                    assert call('screenshot')['result'].get('path')
                    call(step['method'], **step['params'])
                    preparation_retries += 1
            initial = call('wait_for', text=c['initialText'], timeout=30)['result']
            assert initial.get('met') is True, initial
            call('screenshot')  # Fix the displayed geometry before any input.
            phase = 'measure'
            started = time.monotonic()
            if a.mode == 'viewer':
                response = call('app', fault='viewer', action='launch', bundleId=c['bundleId'], relaunch=False)
                assert response['trace'].get('appLaunches') == 1, response['trace']
                action = response['result']
                assert action.get('appLaunched') and action.get('execution') == 'executed', action
                assert int(action['stdout'].strip().rsplit(':', 1)[1]) == pid
                assert action.get('viewer', {}).get('ready') is False
            else:
                response = call('tap', fault='capture' if a.mode == 'capture' else None, **c['tap'])
                action = response['result']
                assert action.get('execution') == 'executed', action
                assert response['trace'].get('touchEvents') == 1, response['trace']
                if a.mode == 'capture':
                    assert action.get('screenshot', {}).get('error') or action.get('observationError'), action
            # Failed observation is recovered with observation only.
            recovered = False
            if not action.get('screenshot', {}).get('path'):
                shot = call('screenshot')['result']
                assert shot.get('path'), shot
                recovered = True
            goal = call('wait_for', text=c['initialText'] if a.mode == 'viewer' else c['targetText'], timeout=15)['result']
            assert goal.get('met') is True, goal
            os.kill(pid, 0)
            rows.append(dict(version=label, round=round_no, case=a.mode, phase='total',
                ms=(time.monotonic() - started) * 1000, goalMet=True, appPid=pid,
                observationRetry=int(recovered), inputRetries=0, preparationInputRetries=preparation_retries)); save()
            phase = 'cleanup'
            for step in c.get('cleanupSteps', []):
                call(step['method'], **step['params'])
finally:
    for w in workers.values():
        w.stdin.close(); w.wait(timeout=20)
