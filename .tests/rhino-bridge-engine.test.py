import queue
import threading
import time
import unittest
import importlib.util
import os

MODULE_PATH = os.path.join(os.path.dirname(__file__), '..', 'rhino-bridge', 'rhino', 'cindy_bridge.py')
SPEC = importlib.util.spec_from_file_location('cindy_bridge', MODULE_PATH)
cindy_bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cindy_bridge)


class FakeBackend(object):
    def __init__(self):
        self.calls = 0
        self.partial = False

    def write(self, action, args, session):
        self.calls += 1
        if self.partial:
            raise cindy_bridge.BridgeError('BRIDGE_PARTIAL', 'partial failure')
        return {'ok': True, 'state': 'applied'}


class RhinoBridgeEngineTest(unittest.TestCase):
    def test_duplicate_operation_is_replayed_without_second_write(self):
        backend = FakeBackend()
        engine = cindy_bridge.Engine(backend)
        args = {'operation_id': 'operation-1'}
        first = engine.dispatch('create', args)
        second = engine.dispatch('create', args)
        self.assertEqual(backend.calls, 1)
        self.assertTrue(second['replayed'])
        self.assertEqual(first['operation_id'], second['operation_id'])

    def test_operation_id_conflict_is_rejected(self):
        engine = cindy_bridge.Engine(FakeBackend())
        engine.dispatch('create', {'operation_id': 'operation-2'})
        result = engine.dispatch('transform', {'operation_id': 'operation-2'})
        self.assertEqual(result['code'], 'BRIDGE_ID_CONFLICT')

    def test_partial_failure_is_recorded_as_a_receipt(self):
        backend = FakeBackend()
        backend.partial = True
        engine = cindy_bridge.Engine(backend)
        result = engine.dispatch('create', {'operation_id': 'operation-3'})
        self.assertEqual(result['code'], 'BRIDGE_PARTIAL')
        receipt = engine.dispatch('operation_result', {'operation_id': 'operation-3'})
        self.assertEqual(receipt['state'], 'recorded')

    def test_expired_queued_request_never_reaches_backend(self):
        backend = FakeBackend()
        server = object.__new__(cindy_bridge.Server)
        server.stop_event = threading.Event()
        server.pending = queue.Queue()
        server.engine = cindy_bridge.Engine(backend)
        job = {'request': {'action': 'create', 'args': {'operation_id': 'operation-4'}},
               'event': threading.Event(), 'deadline': time.time() - 1, 'result': None}
        server.pending.put(job)
        server.tick()
        self.assertEqual(backend.calls, 0)
        self.assertEqual(job['result']['code'], 'BRIDGE_EXPIRED')
        self.assertTrue(job['event'].is_set())


if __name__ == '__main__':
    unittest.main()
