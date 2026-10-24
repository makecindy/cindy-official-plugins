"""Fault injection for the real grading process; never loaded by production."""
import errno, os, pathlib, runpy, shutil, sys, time

runner, phase, marker, *arguments = sys.argv[1:]
sys.argv = [runner, *arguments]
sys.path.insert(0, str(pathlib.Path(runner).parent))
original_link, original_copy = os.link, shutil.copytree
original_read = pathlib.Path.read_bytes


def pause():
    pathlib.Path(marker).write_text(str(os.getpid()))
    while not pathlib.Path(marker + '.continue').exists():
        time.sleep(0.01)


def link(source, destination, *args, **kwargs):
    if pathlib.Path(destination).name == 'grader-execution.json' and phase == 'receipt':
        pause()
    return original_link(source, destination, *args, **kwargs)


def copy(source, destination, *args, **kwargs):
    if phase.startswith('error-'):
        raise OSError(getattr(errno, phase[6:]), 'private path ' + str(source))
    result = original_copy(source, destination, *args, **kwargs)
    if phase == 'copy':
        pause()
    return result


def read_bytes(file):
    data = original_read(file)
    if phase == 'entry-read' and file.name == 'grade.py':
        file.write_bytes(data.replace(b'answer = False', b'answer = True'))
    return data


pathlib.Path.read_bytes = read_bytes
os.link, shutil.copytree = link, copy
runpy.run_path(runner, run_name='__main__')
