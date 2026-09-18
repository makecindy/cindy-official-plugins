#!/usr/bin/env python3
"""Bundle tracked OpenDesign sources without exceeding the plugin entry limit."""
import argparse
import io
from pathlib import Path
import subprocess
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    plugin = repo / "opendesign-trial"
    paths = subprocess.check_output(
        ["git", "ls-files", "-z", "--", "opendesign-trial/source/"], cwd=repo
    ).decode().split("\0")
    sources = {
        str(Path(p).relative_to("opendesign-trial")): (repo / p).read_bytes()
        for p in sorted(filter(None, paths))
    }
    if not sources:
        raise SystemExit("No Git-tracked OpenDesign sources found")
    archive = plugin / "source.zip"
    if args.check:
        with zipfile.ZipFile(archive) as z:
            if sorted(z.namelist()) != sorted(sources):
                raise SystemExit("Source archive paths differ; regenerate source.zip")
            for name, content in sources.items():
                if z.read(name) != content:
                    raise SystemExit(f"Source archive is stale: {name}")
    else:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as z:
            for name, content in sources.items():
                entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                entry.create_system = 3
                entry.external_attr = 0o100644 << 16
                entry.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(entry, content)
        archive.write_bytes(buf.getvalue())
    print(f"{'Verified' if args.check else 'Bundled'} {len(sources)} source files")


if __name__ == "__main__":
    main()
