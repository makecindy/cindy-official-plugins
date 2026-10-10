# -*- coding: utf-8 -*-
# Rhino 6+ IronPython 2.7 / Rhino Python 3 compatible.
from __future__ import print_function
import json
import math
import re
import socket
import threading
import time
import uuid
import hashlib
import binascii
import os
try:
    import Queue as queue
except ImportError:
    import queue
try:
    string_types = (basestring,)
    number_types = (int, long, float)
except NameError:
    string_types = (str,)
    number_types = (int, float)

WRITES = ('create', 'transform', 'create_layer', 'assign_layer')
READS = ('status', 'objects', 'operation_result')
LF = bytes(bytearray([10]))
MAX_RECEIPTS = 5000

class BridgeError(Exception):
    def __init__(self, code, message):
        self.code = code
        self.message = message
        Exception.__init__(self, message)

def fail(code, message):
    return dict(ok=False, code=code, message=message)

def text_value(value, label, limit=160):
    if not isinstance(value, string_types) or not value.strip() or len(value) > limit:
        raise BridgeError('BRIDGE_ARGS', label + u'无效，请按工具说明填写。')
    return value

def number(value, label, positive=False):
    if isinstance(value, bool) or not isinstance(value, number_types):
        raise BridgeError('BRIDGE_ARGS', label + u'必须是数字。')
    value = float(value)
    if math.isnan(value) or math.isinf(value) or abs(value) > 1e12 or (positive and value <= 0):
        raise BridgeError('BRIDGE_ARGS', label + u'超出允许范围，请检查单位与数值。')
    return value

def vector(value, label):
    if not isinstance(value, list) or len(value) != 3:
        raise BridgeError('BRIDGE_ARGS', label + u'必须是三个数字。')
    return [number(x, label) for x in value]

def integer(value, label, low, high):
    n = number(value, label)
    if n != int(n) or n < low or n > high:
        raise BridgeError('BRIDGE_ARGS', label + u'超出允许范围。')
    return int(n)

def only(args, allowed, required=()):
    if not isinstance(args, dict) or set(args) - set(allowed) or any(x not in args for x in required):
        raise BridgeError('BRIDGE_ARGS', u'参数缺失或包含不支持的字段，请按工具说明填写。')

def secure_equal(a, b):
    if not isinstance(a, string_types) or len(a) != len(b):
        return False
    diff = 0
    for x, y in zip(a, b):
        diff |= ord(x) ^ ord(y)
    return diff == 0

class Engine(object):
    # All dispatch calls happen on Rhino's UI thread, via Idle.
    def __init__(self, backend):
        self.backend = backend
        self.session = uuid.uuid4().hex
        self.receipts = {}

    def dispatch(self, action, args):
        try:
            if action not in WRITES + READS:
                raise BridgeError('BRIDGE_ACTION', u'不支持此操作，请使用插件已声明的工具。')
            if action == 'operation_result':
                only(args, ('operation_id',), ('operation_id',))
                op = text_value(args['operation_id'], u'操作编号', 80)
                receipt = self.receipts.get(op)
                return dict(ok=True, session_id=self.session, state='recorded' if receipt else 'unknown', receipt=receipt[1] if receipt else None,
                            note=u'unknown 不代表未执行；重启脚本会清空记录，请核对模型后再决定。')
            if action in READS:
                return self.backend.read(action, args, self.session)
            op = text_value(args.get('operation_id'), u'操作编号', 80)
            if not re.match(r'^[A-Za-z0-9_-]{8,80}$', op):
                raise BridgeError('BRIDGE_ARGS', u'操作编号须为 8–80 位字母、数字、下划线或短横线。')
            digest = hashlib.sha256(json.dumps([action, args], sort_keys=True, ensure_ascii=True, allow_nan=False).encode('utf-8')).hexdigest()
            existing = self.receipts.get(op)
            if existing:
                if existing[0] != digest:
                    raise BridgeError('BRIDGE_ID_CONFLICT', u'操作编号已用于不同参数。请核对原操作结果；新操作使用新编号。')
                answer = dict(existing[1]); answer['replayed'] = True
                return answer
            if len(self.receipts) >= MAX_RECEIPTS:
                raise BridgeError('BRIDGE_CAPACITY', u'本次连接的操作记录已满。请核对全部操作结果后重启连接脚本。')
            try:
                result = self.backend.write(action, args, self.session)
            except BridgeError as ex:
                result = fail(ex.code, ex.message)
            except Exception:
                result = fail('BRIDGE_EXECUTION', u'Rhino 操作异常，结果可能部分完成。请检查模型并使用 Rhino 撤销，勿直接重做。')
            result['operation_id'] = op
            self.receipts[op] = (digest, result)
            return result
        except BridgeError as ex:
            return fail(ex.code, ex.message)
        except Exception:
            return fail('BRIDGE_REQUEST', u'请求处理失败，请检查参数；若为修改操作，请先核对模型与操作记录。')

class RhinoBackend(object):
    def __init__(self):
        import Rhino
        import System
        import System.Drawing
        self.Rhino = Rhino
        self.System = System
        self.G = Rhino.Geometry

    def document(self, args, session, check_units=False):
        doc = self.Rhino.RhinoDoc.ActiveDoc
        if doc is None:
            raise BridgeError('BRIDGE_DOCUMENT', u'没有打开的 Rhino 文档，请先新建或打开模型。')
        doc_id = session + ':' + str(doc.RuntimeSerialNumber)
        if args.get('document_id') != doc_id:
            raise BridgeError('BRIDGE_DOCUMENT_CHANGED', u'目标文档已变化，请重新读取模型状态，核对目标后再操作。')
        if check_units and args.get('units') != str(doc.ModelUnitSystem):
            raise BridgeError('BRIDGE_UNITS_CHANGED', u'模型单位已变化，请重新读取状态并换算尺寸。')
        return doc

    def layer(self, doc, layer_id):
        gid = self.guid(layer_id)
        for layer in doc.Layers:
            if not layer.IsDeleted and layer.Id == gid:
                return layer
        raise BridgeError('BRIDGE_LAYER', u'图层不存在，请重新读取图层列表。')

    def guid(self, value):
        try:
            return self.System.Guid(text_value(value, u'对象或图层 ID', 40))
        except Exception:
            raise BridgeError('BRIDGE_ID', u'对象或图层 ID 无效，请使用查询返回的 ID。')

    def editable_layer(self, layer):
        if layer.IsLocked or not layer.IsVisible:
            raise BridgeError('BRIDGE_LOCKED', u'目标图层已锁定或隐藏，请在 Rhino 中处理后再操作。')

    def objects(self, doc, ids):
        if not isinstance(ids, list) or not 1 <= len(ids) <= 100 or len(set(ids)) != len(ids):
            raise BridgeError('BRIDGE_ARGS', u'每次需要 1–100 个不重复的对象 ID。')
        found = []
        for ident in ids:
            obj = doc.Objects.FindId(self.guid(ident))
            if obj is None or obj.IsDeleted:
                raise BridgeError('BRIDGE_OBJECT', u'对象已不存在，请重新查询对象列表。')
            if obj.IsLocked or obj.IsHidden or obj.IsReference:
                raise BridgeError('BRIDGE_LOCKED', u'对象已锁定、隐藏或属于引用模型，请在 Rhino 中处理后重试。')
            self.editable_layer(doc.Layers[obj.Attributes.LayerIndex])
            found.append(obj)
        return found

    def summary(self, doc, obj):
        box = obj.Geometry.GetBoundingBox(True)
        return dict(id=str(obj.Id), name=(obj.Attributes.Name or '')[:160], type=str(obj.ObjectType),
                    layer_id=str(doc.Layers[obj.Attributes.LayerIndex].Id), selected=bool(obj.IsSelected(False)),
                    locked=bool(obj.IsLocked), hidden=bool(obj.IsHidden), reference=bool(obj.IsReference),
                    bounds=([box.Min.X, box.Min.Y, box.Min.Z, box.Max.X, box.Max.Y, box.Max.Z] if box.IsValid else None))

    def read(self, action, args, session):
        if action == 'status':
            only(args, ())
            doc = self.Rhino.RhinoDoc.ActiveDoc
            if doc is None:
                return dict(ok=True, connected=True, rhino_version=str(self.Rhino.RhinoApp.Version), session_id=session, document=None)
            layers = [dict(id=str(x.Id), name=x.FullPath, visible=x.IsVisible, locked=x.IsLocked) for x in doc.Layers if not x.IsDeleted]
            return dict(ok=True, connected=True, bridge_version='0.1.0', rhino_version=str(self.Rhino.RhinoApp.Version), session_id=session,
                        document=dict(id=session + ':' + str(doc.RuntimeSerialNumber), name=doc.Name, units=str(doc.ModelUnitSystem), tolerance=doc.ModelAbsoluteTolerance),
                        layers=layers[:500], layers_truncated=len(layers) > 500)
        only(args, ('document_id', 'selected_only', 'offset', 'limit'), ('document_id',))
        doc = self.document(args, session)
        offset = integer(args.get('offset', 0), u'分页起点', 0, 10000000)
        limit = integer(args.get('limit', 100), u'分页数量', 1, 200)
        selected = args.get('selected_only', True)
        if not isinstance(selected, bool):
            raise BridgeError('BRIDGE_ARGS', u'selected_only 必须是布尔值。')
        source = doc.Objects.GetSelectedObjects(False, False) if selected else doc.Objects
        rows = []; seen = 0; more = False
        for obj in source:
            if obj.IsDeleted:
                continue
            if seen >= offset:
                if len(rows) == limit:
                    more = True; break
                rows.append(self.summary(doc, obj))
            seen += 1
        return dict(ok=True, document_id=args['document_id'], objects=rows, next_offset=offset + len(rows) if more else None)

    def write(self, action, args, session):
        common = ('operation_id', 'document_id', 'units')
        extra = dict(create=('kind', 'geometry', 'layer_id', 'name'), transform=('object_ids', 'mode', 'vector', 'center', 'axis', 'angle_degrees', 'factor'),
                     create_layer=('name', 'color'), assign_layer=('object_ids', 'layer_id'))[action]
        required = dict(create=('kind', 'geometry'), transform=('object_ids', 'mode'), create_layer=('name',), assign_layer=('object_ids', 'layer_id'))[action]
        only(args, common + extra, common + required)
        doc = self.document(args, session, True)
        G = self.G
        prepared = None
        if action == 'create':
            p = args['geometry']; kind = args['kind']
            if kind == 'point':
                only(p, ('point',), ('point',)); prepared = G.Point(G.Point3d(*vector(p['point'], u'点坐标')))
            elif kind == 'line':
                only(p, ('start', 'end'), ('start', 'end'))
                a = G.Point3d(*vector(p['start'], u'起点')); b = G.Point3d(*vector(p['end'], u'终点'))
                if a.DistanceTo(b) <= doc.ModelAbsoluteTolerance:
                    raise BridgeError('BRIDGE_GEOMETRY', u'线段长度须大于模型容差。')
                prepared = G.LineCurve(a, b)
            elif kind in ('circle', 'sphere'):
                only(p, ('center', 'radius'), ('center', 'radius'))
                center = G.Point3d(*vector(p['center'], u'中心')); radius = number(p['radius'], u'半径', True)
                prepared = G.Circle(G.Plane(center, G.Vector3d.ZAxis), radius).ToNurbsCurve() if kind == 'circle' else G.Sphere(center, radius).ToBrep()
            elif kind == 'box':
                only(p, ('origin', 'size'), ('origin', 'size'))
                origin = G.Point3d(*vector(p['origin'], u'原点')); dims = vector(p['size'], u'尺寸')
                for d in dims: number(d, u'尺寸', True)
                prepared = G.Box(G.Plane(origin, G.Vector3d.ZAxis), G.Interval(0, dims[0]), G.Interval(0, dims[1]), G.Interval(0, dims[2])).ToBrep()
            else:
                raise BridgeError('BRIDGE_GEOMETRY', u'仅支持 point、line、circle、sphere、box。')
            if prepared is None or not prepared.IsValid:
                raise BridgeError('BRIDGE_GEOMETRY', u'几何无效，请检查尺寸与模型容差。')
            attrs = self.Rhino.DocObjects.ObjectAttributes()
            layer = self.layer(doc, args['layer_id']) if args.get('layer_id') else doc.Layers.CurrentLayer
            self.editable_layer(layer); attrs.LayerIndex = layer.Index
            if 'name' in args: attrs.Name = text_value(args['name'], u'对象名称')
        elif action == 'transform':
            items = self.objects(doc, args['object_ids']); mode = args['mode']
            if mode == 'move':
                only(args, common + ('object_ids', 'mode', 'vector'), common + ('object_ids', 'mode', 'vector'))
                xform = G.Transform.Translation(G.Vector3d(*vector(args['vector'], u'位移')))
            elif mode == 'rotate':
                only(args, common + ('object_ids', 'mode', 'center', 'axis', 'angle_degrees'), common + ('object_ids', 'mode', 'center', 'axis', 'angle_degrees'))
                axis = G.Vector3d(*vector(args['axis'], u'旋转轴'))
                if not axis.Unitize(): raise BridgeError('BRIDGE_ARGS', u'旋转轴不能为零。')
                xform = G.Transform.Rotation(math.radians(number(args['angle_degrees'], u'角度')), axis, G.Point3d(*vector(args['center'], u'旋转中心')))
            elif mode == 'scale':
                only(args, common + ('object_ids', 'mode', 'center', 'factor'), common + ('object_ids', 'mode', 'center', 'factor'))
                xform = G.Transform.Scale(G.Point3d(*vector(args['center'], u'缩放中心')), number(args['factor'], u'缩放倍数', True))
            else: raise BridgeError('BRIDGE_ARGS', u'变换模式须为 move、rotate 或 scale。')
            prepared = []
            for obj in items:
                geo = obj.Geometry.Duplicate()
                if geo is None or not geo.Transform(xform) or not geo.IsValid:
                    raise BridgeError('BRIDGE_GEOMETRY', u'对象无法完成此次变换，未修改模型，请检查对象类型与参数。')
                prepared.append((obj.Id, geo))
        elif action == 'create_layer':
            name = text_value(args['name'], u'图层名称')
            if any(c in name for c in ('::', chr(10), chr(13))):
                raise BridgeError('BRIDGE_ARGS', u'第一版只创建顶层图层，请使用不含 :: 或换行的名称。')
            if any(not x.IsDeleted and x.FullPath.lower() == name.lower() for x in doc.Layers):
                raise BridgeError('BRIDGE_LAYER_EXISTS', u'同名图层已存在，请使用现有图层 ID 或换一个名称。')
            layer = self.Rhino.DocObjects.Layer(); layer.Name = name
            if 'color' in args:
                color = args['color']
                if not isinstance(color, list) or len(color) != 3: raise BridgeError('BRIDGE_ARGS', u'颜色须为三个 0–255 的整数。')
                layer.Color = self.System.Drawing.Color.FromArgb(*[integer(v, u'颜色', 0, 255) for v in color])
        else:
            items = self.objects(doc, args['object_ids']); layer = self.layer(doc, args['layer_id']); self.editable_layer(layer)
            prepared = []
            for obj in items:
                attr = obj.Attributes.Duplicate(); attr.LayerIndex = layer.Index; prepared.append((obj.Id, attr))
        undo = doc.BeginUndoRecord('Cindy Rhino Bridge: ' + action)
        if undo == 0:
            raise BridgeError('BRIDGE_UNDO', u'Rhino 当前无法建立撤销记录，请结束当前命令后重试。')
        changed = []; layer_id = None
        try:
            if action == 'create':
                ident = doc.Objects.Add(prepared, attrs)
                if ident == self.System.Guid.Empty: raise RuntimeError('add failed')
                changed.append(str(ident))
            elif action == 'create_layer':
                index = doc.Layers.Add(layer)
                if index < 0: raise RuntimeError('layer failed')
                layer_id = str(doc.Layers[index].Id)
            else:
                for ident, value in prepared:
                    success = doc.Objects.Replace(ident, value) if action == 'transform' else doc.Objects.ModifyAttributes(ident, value, True)
                    if not success: raise RuntimeError('modify failed')
                    changed.append(str(ident))
        except Exception:
            return dict(ok=False, code='BRIDGE_PARTIAL', message=u'操作中断，可能部分完成。已修改对象：' + ', '.join(changed) + u'。请检查模型并在 Rhino 中撤销；不要直接重做。', object_ids=changed, undo_serial=int(undo))
        finally:
            doc.EndUndoRecord(undo)
            doc.Views.Redraw()
        return dict(ok=True, document_id=args['document_id'], units=args['units'], object_ids=changed, layer_id=layer_id, undo_serial=int(undo), undo_hint=u'在 Rhino 中使用 Undo 撤销最近一次修改。')

class Server(object):
    def __init__(self, backend, port, token=None):
        self.engine = Engine(backend)
        self.token = token or binascii.hexlify(os.urandom(32)).decode('ascii')
        self.port = port
        self.pending = queue.Queue(16)
        self.stop_event = threading.Event()
        self.listener = None
        self.slots = threading.BoundedSemaphore(8)

    def start(self):
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            listener.bind(('127.0.0.1', self.port)); listener.listen(8); listener.settimeout(0.5)
        except Exception:
            listener.close(); raise
        self.listener = listener
        self.port = listener.getsockname()[1]
        thread = threading.Thread(target=self.accept_loop); thread.daemon = True; thread.start()

    def stop(self):
        self.stop_event.set()
        if self.listener:
            self.listener.close()
        while True:
            try:
                job = self.pending.get_nowait()
                job['result'] = fail('BRIDGE_STOPPED', u'连接已停止；此排队请求未执行，请重新连接后核对模型。'); job['event'].set()
            except queue.Empty:
                break

    def accept_loop(self):
        while not self.stop_event.is_set():
            try:
                client, _ = self.listener.accept()
            except socket.timeout:
                continue
            except Exception:
                break
            if not self.slots.acquire(False):
                client.close(); continue
            thread = threading.Thread(target=self.handle, args=(client,)); thread.daemon = True; thread.start()

    def handle(self, client):
        request = {}; result = None
        try:
            deadline = time.time() + 3.0
            data = b''
            while LF not in data:
                remaining = deadline - time.time()
                if remaining <= 0:
                    raise socket.timeout()
                client.settimeout(remaining)
                chunk = client.recv(4096)
                if not chunk: raise ValueError('incomplete')
                data += chunk
                if len(data) > 262144: raise ValueError('large')
            request = json.loads(data.split(LF, 1)[0].decode('utf-8'))
            if not isinstance(request, dict): raise ValueError('request')
            if request.get('protocol') != 1 or not isinstance(request.get('id'), string_types) or len(request['id']) > 80:
                raise ValueError('protocol')
            if not secure_equal(request.get('token'), self.token):
                result = fail('BRIDGE_AUTH', u'配对密钥不匹配，请在插件设置中更新本次 Rhino 连接的密钥。')
            elif request.get('action') not in WRITES + READS or not isinstance(request.get('args'), dict):
                result = fail('BRIDGE_ARGS', u'请求操作或参数不合法，请使用插件工具。')
            else:
                job = dict(request=request, event=threading.Event(), deadline=time.time() + 10, result=None)
                try:
                    self.pending.put_nowait(job)
                    job['event'].wait(13)
                    result = job['result'] or fail('BRIDGE_OUTCOME_UNKNOWN', u'Rhino 尚未返回结果，请用原操作编号查询，勿直接重做。')
                except queue.Full:
                    result = fail('BRIDGE_BUSY', u'Rhino 请求队列已满，此请求未入队，请稍后重试。')
            payload = json.dumps(dict(protocol=1, id=request['id'], result=result), ensure_ascii=True, allow_nan=False).encode('utf-8') + LF
            if len(payload) > 786432:
                payload = json.dumps(dict(protocol=1, id=request['id'], result=fail('BRIDGE_RESPONSE_SIZE', u'返回内容过大，请缩小查询范围；修改请查询原操作编号。'))).encode('utf-8') + LF
            client.sendall(payload)
        except Exception:
            # No request, token, model names or exception details in logs.
            pass
        finally:
            client.close(); self.slots.release()

    def tick(self, sender=None, event=None):
        if self.stop_event.is_set(): return
        # One bounded operation per Idle event, never call Rhino from socket threads.
        try: job = self.pending.get_nowait()
        except queue.Empty: return
        if time.time() > job['deadline']:
            job['result'] = fail('BRIDGE_EXPIRED', u'Rhino 忙碌导致请求过期，此排队请求未执行。请结束命令后重试。')
        else:
            request = job['request']
            job['result'] = self.engine.dispatch(request['action'], request['args'])
        job['event'].set()


def run_in_rhino():
    import Rhino
    import rhinoscriptsyntax as rs
    import scriptcontext as sc
    key = 'cindy-rhino-bridge-v1'
    previous = sc.sticky.get(key)
    if previous:
        server, on_idle, on_close = previous
        server.stop()
        Rhino.RhinoApp.Idle -= on_idle
        Rhino.RhinoApp.Closing -= on_close
        del sc.sticky[key]
        Rhino.RhinoApp.WriteLine('Cindy Rhino Bridge stopped. Run script again to start.')
        return
    if Rhino.RhinoApp.Version.Major < 6:
        rs.MessageBox('Rhino 6 or later is required.', 0, 'Cindy Rhino Bridge'); return
    port = rs.GetInteger('Cindy Rhino Bridge port', 19986, 1024, 65535)
    if port is None: return
    server = Server(RhinoBackend(), port)
    try: server.start()
    except Exception:
        rs.MessageBox('Cannot listen on this port. Choose another port and use the same port in Cindy settings.', 0, 'Cindy Rhino Bridge'); return
    def on_idle(sender, event):
        server.tick()
    def on_close(sender, event):
        server.stop()
    Rhino.RhinoApp.Idle += on_idle
    Rhino.RhinoApp.Closing += on_close
    sc.sticky[key] = (server, on_idle, on_close)
    # Dialog only: do not print the pairing token to command history.
    rs.EditBox(server.token, 'Copy this key into Cindy Rhino Bridge settings, then close this dialog. Keep the key out of chat. Running this script again stops the bridge.', 'Cindy Rhino Bridge pairing key')
    Rhino.RhinoApp.WriteLine('Cindy Rhino Bridge listening on 127.0.0.1:' + str(port))

if __name__ == '__main__':
    run_in_rhino()
