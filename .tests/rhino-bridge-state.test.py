import importlib.util
import pathlib
import json
import threading
import time
import unittest
from types import SimpleNamespace as NS
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location('bridge', pathlib.Path(__file__).resolve().parents[1] / 'rhino-bridge/rhino/cindy_bridge.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)

class States(unittest.TestCase):
    def test_capacity_conflict_and_replay(self):
        backend = NS(write=Mock(return_value={'ok': True}))
        engine = b.Engine(backend)
        args = {'operation_id': 'operation-test'}
        self.assertEqual(engine.dispatch('create', args)['execution_state'], 'executed')
        self.assertEqual(engine.dispatch('create', args)['execution_state'], 'executed')
        self.assertEqual(engine.dispatch('transform', args)['execution_state'], 'not_executed')
        with patch.object(b, 'MAX_RECEIPTS', 1):
            self.assertEqual(engine.dispatch('create', {'operation_id': 'operation-other'})['execution_state'], 'not_executed')
        self.assertEqual(backend.write.call_count, 1)

    def test_real_backend_document_and_units_rejections(self):
        backend = object.__new__(b.RhinoBackend)
        backend.Rhino = NS(RhinoDoc=NS(ActiveDoc=NS(RuntimeSerialNumber=1, ModelUnitSystem='mm')))
        engine = b.Engine(backend)
        for doc, units, code in [('wrong','mm','BRIDGE_DOCUMENT_CHANGED'), (engine.session+':1','cm','BRIDGE_UNITS_CHANGED')]:
            result = engine.dispatch('create_layer', dict(operation_id=code, document_id=doc, units=units, name='test'))
            self.assertEqual(result['code'], code)
            self.assertEqual(result['execution_state'], 'not_executed')

    def test_auth_and_queue_full_at_wire_boundary(self):
        server = b.Server(NS(write=Mock()), 19986, 'a'*64)
        for _ in range(16): server.pending.put({})
        for token, code in [('b'*64, 'BRIDGE_AUTH'), ('a'*64, 'BRIDGE_BUSY')]:
            request = dict(protocol=1, id='test', token=token, action='create', args={})
            client = Mock()
            client.recv.return_value = json.dumps(request).encode() + b.LF
            server.slots.acquire()
            server.handle(client)
            result = json.loads(client.sendall.call_args[0][0])['result']
            self.assertEqual(result['code'], code)
            self.assertEqual(result['execution_state'], 'not_executed')
        server.engine.backend.write.assert_not_called()

    def test_stopped_and_expired_jobs(self):
        for expired in [True, False]:
            server = b.Server(NS(write=Mock()), 19986)
            job = dict(event=threading.Event(), deadline=time.time()-1, result=None)
            server.pending.put(job)
            server.tick() if expired else server.stop()
            self.assertTrue(job['event'].is_set())
            self.assertEqual(job['result']['execution_state'], 'not_executed')
            server.engine.backend.write.assert_not_called()

    def test_uncertain_exception_and_explicit_partial_receipt(self):
        for outcome, state in [(RuntimeError('lost'), 'unknown'), ({'ok':False, 'execution_state':'executed', 'object_ids':['obj']}, 'executed')]:
            backend = NS(write=Mock(side_effect=outcome) if isinstance(outcome, Exception) else Mock(return_value=outcome))
            engine = b.Engine(backend)
            result = engine.dispatch('create', {'operation_id':'operation-test'})
            self.assertEqual(result['execution_state'], state)
            self.assertEqual(engine.dispatch('operation_result', {'operation_id':'operation-test'})['receipt']['execution_state'], state)

    def test_pairing_dialog_uses_editable_default_value(self):
        class Event:
            def __iadd__(self, callback): return self
        app = NS(Version=NS(Major=8), Idle=Event(), Closing=Event(), WriteLine=Mock())
        rs = NS(GetInteger=Mock(return_value=19986), EditBox=Mock())
        server = NS(token='a'*64, start=Mock())
        with patch.dict('sys.modules', {'Rhino':NS(RhinoApp=app), 'rhinoscriptsyntax':rs, 'scriptcontext':NS(sticky={})}), patch.object(b, 'RhinoBackend'), patch.object(b, 'Server', return_value=server):
            b.run_in_rhino()
        args = rs.EditBox.call_args[1]
        self.assertEqual(args['default_string'], server.token)
        self.assertNotIn(server.token, args['message'])
        for call in app.WriteLine.call_args_list: self.assertNotIn(server.token, str(call))

    def test_real_write_partial_and_finalize_failures(self):
        for successes, finalize, expected in [([False], False, 'unknown'), ([True,False], False, 'executed'), ([True,True], True, 'executed')]:
            backend = object.__new__(b.RhinoBackend)
            backend.G = NS()
            doc = NS(BeginUndoRecord=Mock(return_value=1), EndUndoRecord=Mock(side_effect=RuntimeError('finalize') if finalize else None), Views=NS(Redraw=Mock()), Objects=NS(ModifyAttributes=Mock(side_effect=successes)))
            backend.document = Mock(return_value=doc)
            backend.layer = Mock(return_value=NS(Index=1))
            backend.editable_layer = Mock()
            backend.objects = Mock(return_value=[NS(Id=str(i), Attributes=NS(Duplicate=Mock(return_value=NS()))) for i in range(len(successes))])
            engine = b.Engine(backend)
            result = engine.dispatch('assign_layer', dict(operation_id='operation-partial', document_id='doc', units='mm', object_ids=['a'], layer_id='layer'))
            self.assertFalse(result['ok'])
            self.assertEqual(result['execution_state'], expected)

if __name__ == '__main__': unittest.main()
