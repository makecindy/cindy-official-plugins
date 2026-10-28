#!/usr/bin/env python3
"""Aggregate private replay JSON without printing paths, App data or identifiers.

P90 uses nearest rank (the maximum when n < 10). Waiting is elapsed time inside
install_status/wait_for calls, not an estimate of CPU-idle or model thinking.
Trials without a successful total record are excluded from latency; repeated
preparation starts still count as attempts. Call/preparation totals include
failed attempts; measured wait totals describe the completed measurements.
"""
import argparse
import json
import math
import pathlib
import statistics

p = argparse.ArgumentParser()
p.add_argument('files', nargs='+')
a = p.parse_args()
summary = []
for filename in a.files:
    rows = json.loads(pathlib.Path(filename).read_text())
    for case in sorted({r['case'] for r in rows}):
        for version in ['baseline', 'candidate']:
            group = [r for r in rows if r['case'] == case and r['version'] == version]
            totals = [r for r in group if r['phase'] == 'total' and r.get('goalMet')]
            completed = {r['round'] for r in totals}
            calls = [r for r in group if r['phase'] == 'measure' and r['round'] in completed]
            times = sorted(r['ms'] / 1000 for r in totals)
            waits = [r for r in calls if r['method'] == 'wait_for' or r.get('params', {}).get('action') == 'install_status']
            all_calls = [r for r in group if r.get('method')]
            attempts = all_calls
            actions = [r for r in calls if r['method'] == 'tap' or r.get('params', {}).get('action') == 'launch']
            action_times = sorted(r['ms'] / 1000 for r in actions)
            preparation_starts = sum(r['phase'] == 'begin' or (r['phase'] == 'prepare' and r.get('method') == 'app'
                and r.get('params', {}).get('action') == 'launch') for r in group)
            attempt_count = max(preparation_starts, len({r['round'] for r in group}))
            summary.append(dict(case=case, version=version, n=len(totals),
                incomplete=len({r['round'] for r in group} - completed),
                attemptCount=attempt_count, abortedAttempts=max(0, attempt_count-len(totals)),
                medianSeconds=statistics.median(times) if times else None,
                p90Seconds=times[math.ceil(len(times)*.9)-1] if times else None,
                callCount=len(calls), failedCalls=sum(not r.get('ok', True) for r in calls),
                allCallCount=len(all_calls),
                attemptedCallCount=len(attempts), allFailedCalls=sum(not r.get('ok', True) for r in attempts),
                preparationStarts=preparation_starts,
                preparationAndCleanupSeconds=sum(r['ms'] for r in all_calls if r['phase'] != 'measure') / 1000,
                actionMedianSeconds=statistics.median(action_times) if action_times else None,
                actionP90Seconds=action_times[math.ceil(len(action_times)*.9)-1] if action_times else None,
                expectedObservationFailures=sum(bool(r.get('result', {}).get('screenshot', {}).get('error')
                    or r.get('result', {}).get('observationError')
                    or r.get('result', {}).get('viewer', {}).get('ready') is False) for r in actions),
                waitingSeconds=sum(r['ms'] for r in waits) / 1000,
                observationRetries=sum(r.get('observationRetry', 0) for r in totals),
                inputRetries=sum(r.get('inputRetries', 0) for r in totals),
                phaseTotalsMs={phase:sum(r.get('result', {}).get('phaseMs', {}).get(phase, 0)
                    for r in calls if r.get('result', {}).get('state') == 'done')
                    for phase in sorted({k for r in calls for k in r.get('result', {}).get('phaseMs', {})})}))
print(json.dumps(summary, indent=2))
