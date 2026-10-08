"""Read and execute the registered trusted grader entrypoint from the same bytes."""
import hashlib
import pathlib
import sys
import types


def read_entry(grader, expected_hash):
    data = grader.read_bytes()
    return data if hashlib.sha256(data).hexdigest() == expected_hash else None


def execute_entry(grader, data, source, output):
    sys.argv = [str(grader), str(source), str(output)]
    sys.path.insert(0, str(grader.parent))
    code = 0
    previous_main = sys.modules['__main__']
    module = types.ModuleType('__main__')
    module.__dict__.update(__file__=str(grader), __package__='', __spec__=None,
                           __loader__=None, __cached__=None)
    sys.modules['__main__'] = module
    try:
        exec(compile(data, str(grader), 'exec'), module.__dict__)
    except SystemExit as error:
        code = error.code if isinstance(error.code, int) else (0 if error.code is None else 1)
    except Exception:
        code = 1
    finally:
        sys.modules['__main__'] = previous_main
    return code


if __name__ == '__main__':
    grader = pathlib.Path(sys.argv[1])
    data = read_entry(grader, sys.argv[2])
    sys.exit(76 if data is None else execute_entry(grader, data, sys.argv[3], sys.argv[4]))
