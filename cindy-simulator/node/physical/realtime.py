# SPDX-License-Identifier: GPL-3.0-or-later
"""Private stdio bridge. Only video and explicitly requested HID; no HTTP/audio/clipboard server.

pymobiledevice3 is version/hash locked. Its RTP depacketizer and receiver reports
are reused, not its web server or queued input worker. stdin EOF releases input.
"""
import asyncio
import base64
import contextlib
import json
import logging
import signal
import sys
import io
import time
import av

from pymobiledevice3.remote.native_tunnel import NativeRemotedTunnel
from pymobiledevice3.remote.core_device.screen_stream import (
    ScreenStreamServer, _SubState, _KernelUdp, hevc_decoder_configuration_record,
)
from pymobiledevice3.remote.core_device.hid_service import (
    UniversalHIDServiceService, TouchscreenContact, IndigoHIDService,
    HID_BUTTON_STATE_DOWN, HID_BUTTON_STATE_UP,
)
from pymobiledevice3.remote.core_device.device_info import DeviceInfoService
from pymobiledevice3.services.power_assertion import PowerAssertionService


async def main():
    loop = asyncio.get_running_loop()
    if not hasattr(loop, 'sock_sendto'):
        # Xcode supplies Python 3.9. asyncio.sock_sendto arrived in 3.11;
        # without this adapter the upstream RTCP task dies and iOS expires
        # video after 20 seconds, even though initial pictures look healthy.
        async def sendto(transport, data, ip, port):
            while True:
                try:
                    transport._sock.sendto(data, (ip, port, 0, 0))
                    return
                except (BlockingIOError, InterruptedError):
                    writable = loop.create_future()
                    fd = transport._sock.fileno()
                    loop.add_writer(fd, lambda: not writable.done() and writable.set_result(None))
                    try:
                        await writable
                    finally:
                        loop.remove_writer(fd)
        _KernelUdp.sendto = sendto
    reader = asyncio.StreamReader(limit=65536)
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin.buffer)
    transport, protocol = await loop.connect_write_pipe(asyncio.streams.FlowControlMixin, sys.stdout.buffer)
    writer = asyncio.StreamWriter(transport, protocol, None, loop)
    output_lock = asyncio.Lock()

    async def emit(data):
        async with output_lock:
            writer.write(data)
            await writer.drain()

    async def event(data):
        data = b'\x03' + json.dumps(data, separators=(',', ':')).encode()
        await emit(len(data).to_bytes(4, 'big') + data)

    config = json.loads(await reader.readline())
    # Start capture only after the first authenticated browser has subscribed,
    # so its decoder receives the initial IDR, not just a mid-GOP delta stream.
    if json.loads(await reader.readline()).get('op') != 'start':
        return
    stopped = asyncio.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stopped.set)
    async with NativeRemotedTunnel(serial=config['serial']) as rsd:
        if rsd.udid != config['serial']:
            raise RuntimeError('Selected device identity changed')
        screen = config['screen']
        server = ScreenStreamServer(rsd, display_id=screen['displayId'], audio_default_on=False, motion_idr=False, rctl_enabled=True)
        # Never call serve(): that would expose extra routes and start audio.
        queue = asyncio.Queue(maxsize=64)
        server._subscribers[queue] = _SubState()
        hid = UniversalHIDServiceService(rsd)
        contacts = []
        gesture = None
        last_input = loop.time()
        video_input_at = 0
        input_lock = asyncio.Lock()
        tasks = []
        latest_frame = None
        latest_metadata = None
        frame_sequence = 0

        async def release():
            nonlocal contacts, gesture
            previous, contacts, gesture = contacts, [], None
            if previous:
                await hid.send_multitouch([p._replace(touching=False) for p in previous])

        async def video():
            nonlocal latest_frame, latest_metadata, frame_sequence
            codec = None
            decoder = None
            while True:
                msg = await queue.get()
                captured_at = round(time.time() * 1000)
                if msg[4] != 1:
                    new = {'codec': server._codec_string, 'description': base64.b64encode(
                        hevc_decoder_configuration_record(server._vps_nal, server._sps_nal, server._pps_nal)).decode()}
                    if new != codec:
                        codec = new
                        await event({'type': 'codec', **codec, 'screen': screen})
                await emit(msg)
                if decoder is None or msg[4] == 2:
                    if msg[4] == 1:
                        continue
                    decoder = av.CodecContext.create('hevc', 'r')
                    decoder.extradata = base64.b64decode(codec['description'])
                    decoder.thread_count = 2
                    decoder.thread_type = 'SLICE'
                try:
                    frames = await asyncio.to_thread(decoder.decode, av.Packet(msg[5:]))
                except av.FFmpegError:
                    decoder = latest_frame = latest_metadata = None
                    await event({'type': 'frame-invalid'})
                    server._request_recovery_idr(reason='agent-decoder')
                    continue
                if frames:
                    latest_frame = frames[-1]
                    frame_sequence += 1
                    latest_metadata = {'sequence': frame_sequence, 'capturedAt': captured_at}
                    await event({'type': 'frame', **latest_metadata})

        def encode_frame(frame):
            out = io.BytesIO()
            frame.to_image().save(out, format='JPEG', quality=92)
            return base64.b64encode(out.getvalue()).decode()

        async def commands():
            nonlocal contacts, gesture, last_input, video_input_at
            while not stopped.is_set():
                line = await reader.readline()
                if not line:
                    stopped.set()
                    return
                p = json.loads(line)
                sent = False
                try:
                    if p.get('op') == 'snapshot':
                        if latest_frame is None:
                            raise ValueError('VIDEO_NOT_READY')
                        frame, metadata = latest_frame, latest_metadata
                        encoded = await asyncio.to_thread(encode_frame, frame)
                        await event({'type': 'ack', 'id': p['id'], 'ok': True,
                                     'execution': 'not_executed', 'image': encoded,
                                     'screen': screen, **metadata})
                        continue
                    async with input_lock:
                        op = p['op']
                        if op == 'keyframe':
                            server._request_recovery_idr(reason='viewer')
                        elif op == 'home':
                            video_input_at = loop.time()
                            await release()
                            async with IndigoHIDService(rsd) as buttons:
                                sent = True
                                try:
                                    await buttons.send_button(0x0C, 0x40, HID_BUTTON_STATE_DOWN)
                                    await asyncio.sleep(.05)
                                finally:
                                    await asyncio.wait_for(buttons.send_button(0x0C, 0x40, HID_BUTTON_STATE_UP), 1)
                        elif op == 'cancel':
                            if gesture is None or p.get('gesture') in (None, gesture):
                                sent = bool(contacts)
                                await release()
                        elif op == 'heartbeat':
                            if gesture == p.get('gesture'):
                                last_input = loop.time()
                        elif op in ('begin', 'move', 'end'):
                            if p.get('screen') != screen:
                                await release()
                                raise ValueError('SCREEN_CHANGED')
                            if op == 'begin':
                                if gesture is not None:
                                    raise ValueError('INPUT_BUSY')
                                gesture = p['gesture']
                                video_input_at = loop.time()
                            elif gesture != p.get('gesture'):
                                raise ValueError('INPUT_EXPIRED')
                            points = p['points']
                            if not 1 <= len(points) <= 2 or (contacts and len(points) != len(contacts)):
                                raise ValueError('INVALID_CONTACTS')
                            if any(len(p) != 2 or any(not isinstance(n, (float, int)) or not 0 <= n <= 65535 for n in p) for p in points):
                                raise ValueError('INVALID_COORDINATES')
                            contacts = [TouchscreenContact(i + 2, round(p[0]), round(p[1])) for i, p in enumerate(points)]
                            sent = True
                            if op == 'end':
                                await release()
                            else:
                                await hid.send_multitouch(contacts)
                            last_input = loop.time()
                        else:
                            raise ValueError('INVALID_OPERATION')
                    await event({'type': 'ack', 'id': p['id'], 'ok': True, 'execution': 'dispatched' if sent else 'not_executed'})
                except Exception as e:
                    with contextlib.suppress(Exception):
                        await asyncio.wait_for(release(), 1)
                    await event({'type': 'ack', 'id': p.get('id'), 'ok': False, 'message': str(e), 'execution': 'unknown' if sent else 'not_executed'})

        async def watchdog():
            tick = 0
            while True:
                await asyncio.sleep(.25)
                if contacts and loop.time() - last_input > 1.5:
                    async with input_lock:
                        expired = gesture
                        await asyncio.wait_for(release(), 1)
                        await event({'type': 'released', 'gesture': expired})
                for transport_task in (server._active_recv_task, server._active_rtcp_task):
                    if transport_task is not None and transport_task.done():
                        transport_task.result()
                        raise RuntimeError('VIDEO_TRANSPORT_CLOSED')
                # A quiet iOS screen may stop emitting frames. Keep geometry
                # and transport checks alive instead of repeatedly restarting
                # a healthy, idle encoder. Input must still get prompt video.
                waiting_for_input = video_input_at > server._last_good_au_t
                if loop.time() - max(server._last_good_au_t, video_input_at) > (8 if contacts or waiting_for_input else 45):
                    raise RuntimeError('VIDEO_STALLED')
                tick += 1
                if tick % 4 == 0:
                    state = server._subscribers[queue]
                    await event({'type': 'health', 'received': server._rtp_frames_received,
                                 'needsKey': state.needs_key, 'queued': queue.qsize(),
                                 'packets': server._rtp_packets_received})

        async def geometry():
            # A changed panel/orientation retires this whole generation; never
            # apply a delayed touch to a differently oriented/folded screen.
            async with DeviceInfoService(rsd) as info:
                while True:
                    await asyncio.sleep(1)
                    displays = (await asyncio.wait_for(info.get_display_info(), 3))['displays']
                    integrated = [d for d in displays if 'integrated' in d.get('type', {})]
                    active = [d for d in integrated if d.get('active', len(integrated) == 1)]
                    d = next((d for d in active if d.get('primary')), active[0] if len(active) == 1 else None)
                    if d is None or d.get('backlightState') == 'off':
                        raise RuntimeError('DISPLAY_ASLEEP')
                    current = {'displayId': d['displayId'], 'width': d['bounds'][1][0] / d['pointScale'],
                               'height': d['bounds'][1][1] / d['pointScale'], 'rotation': d['currentOrientation']}
                    if current != screen:
                        raise RuntimeError('SCREEN_CHANGED')

        async def keep_awake():
            # Short, owned assertions; never unlock or change Auto-Lock settings.
            while True:
                with contextlib.suppress(Exception):
                    async with PowerAssertionService(rsd) as power:
                        async with power.create_power_assertion('PreventUserIdleSystemSleep', 'Cindy live viewer', 20):
                            await asyncio.sleep(10)
                await asyncio.sleep(1)

        try:
            await asyncio.wait_for(server._ensure_fresh_stream(), 20)
            await asyncio.wait_for(hid.connect(), 5)
            tasks = [asyncio.create_task(f()) for f in (video, commands, watchdog, geometry, keep_awake, server._rctl_feedback_loop)]
            stop_task = asyncio.create_task(stopped.wait())
            tasks.append(stop_task)
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                if task is not stop_task:
                    task.result()
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            with contextlib.suppress(Exception):
                await asyncio.wait_for(release(), 1)
            with contextlib.suppress(Exception):
                await asyncio.wait_for(hid.close(), 1)
            # Close only our receiver/service. The device expires this session
            # on its negotiated 20-second RTCP timeout. Never stop other viewers.
            with contextlib.suppress(Exception):
                await asyncio.wait_for(server._stop_active_stream(), 3)


if __name__ == '__main__':
    logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, BrokenPipeError):
        pass
