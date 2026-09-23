"""Offline fixtures plus an opt-in live download; never execute dependencies."""
import hashlib
from contextlib import redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("packager", ROOT / ".github/scripts/binary-dependencies.py")
packager = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(packager)
CONTENT = b"fixture asset, not executable code\n"


def config():
    return {"schemaVersion": 1, "dependencies": [{
        "name": "example-cli", "version": "1.2.3", "license": "THIRD-PARTY-LICENSES.txt",
        "assets": [{
            "platforms": [platform],
            "url": f"https://downloads.example.com/v1.2.3/{platform}",
            "sha256": hashlib.sha256(CONTENT).hexdigest(), "format": "file",
            "files": [{"target": f"vendor/example-cli/{platform}/tool", "executable": True}],
        } for platform in sorted(packager.PLATFORMS)],
    }]}


class PackagingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.paths = {"ghost.json": "file", "third-party-licenses.txt": "file"}

    def validate(self, value):
        return packager.validate_config(json.dumps(value).encode(), self.paths)

    def source(self, value=None):
        target = self.directory / "source.zip"
        with zipfile.ZipFile(target, "w") as bundle:
            bundle.writestr("ghost.json", '{"id":"fixture","node":{"entry":"worker.cjs"}}')
            bundle.writestr("worker.cjs", "// fixture")
            bundle.writestr("THIRD-PARTY-LICENSES.txt", "Fixture license")
            if value is not None:
                bundle.writestr(packager.CONFIG, json.dumps(value))
        return target

    def test_complete_config_and_rejections(self):
        self.assertEqual(len(self.validate(config())), 1)
        mutations = [
            lambda c: c.update(script="curl | sh"),
            lambda c: c.update(schemaVersion=True),
            lambda c: c["dependencies"][0].update(version="latest"),
            lambda c: c["dependencies"][0].update(license="missing.txt"),
            lambda c: c["dependencies"][0]["assets"].pop(),
            lambda c: c["dependencies"][0].update(assets=[]),
            lambda c: c["dependencies"][0]["assets"][0].update(platforms=[]),
            lambda c: c["dependencies"][0]["assets"][0].update(platforms=["unknown"]),
            lambda c: c["dependencies"][0]["assets"][0].update(platforms=["linux-x64", "linux-x64"]),
        ]
        for mutate in mutations:
            value = config()
            mutate(value)
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.validate(value)
        for key, value in [("sha256", "bad"), ("url", "http://example.com/file"), ("format", "7z"), ("script", "echo bad")]:
            declaration = config()
            declaration["dependencies"][0]["assets"][0][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.validate(declaration)
        for target in ["../tool", "/tool", "vendor/other/linux-x64/tool", "vendor/example-cli/linux-x64/CON.exe"]:
            declaration = config()
            declaration["dependencies"][0]["assets"][0]["files"][0]["target"] = target
            with self.subTest(target=target), self.assertRaises(ValueError):
                self.validate(declaration)
        self.paths["vendor/example-cli/linux-x64/tool"] = "file"
        with self.assertRaisesRegex(ValueError, "conflicting"):
            self.validate(config())
        with self.assertRaisesRegex(ValueError, "Duplicate JSON"):
            packager.validate_config(b'{"schemaVersion":1,"schemaVersion":1}', {})

    def test_paths(self):
        for name in ["../file", "/file", "a/../b", "a\\b", "C:/file", "nul.txt", "a/./b", "a//b"]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                packager.safe_path(name)
        paths = {}
        packager.add_path(paths, "Dir/File")
        for name in ["dir/file", "dir", "Dir/File/sub"]:
            with self.assertRaises(ValueError):
                packager.add_path(paths, name)

    def test_expanded_limits_include_exact_boundary_and_preserve_sandbox_limit(self):
        for node, limit in [(True, 256), (False, 32)]:
            with self.subTest(node=node):
                source = self.directory / "limits.zip"
                with zipfile.ZipFile(source, "w") as bundle:
                    bundle.writestr("ghost.json", json.dumps({"node": {"entry": "worker.cjs"}} if node else {}))
                    bundle.writestr("payload.bin", b"")
                with zipfile.ZipFile(source) as bundle:
                    # Only metadata is needed by this preflight; server tests
                    # independently stream actual expanded bytes.
                    payload = bundle.getinfo("payload.bin")
                    payload.file_size = limit * packager.MIB - bundle.getinfo("ghost.json").file_size
                    self.assertEqual(packager.inspect_package(bundle)[2], limit * packager.MIB)
                    payload.file_size += 1
                    with self.assertRaisesRegex(ValueError, "expanded size limit"):
                        packager.inspect_package(bundle)

    def test_archive_limits_include_exact_boundary_and_preserve_sandbox_limit(self):
        # Scale the unit, not the thresholds, to exercise real ZIP/stat/copy
        # paths without allocating hundreds of MiB for this boundary test.
        for node, limit in [(True, 128), (False, 8)]:
            with self.subTest(node=node), patch.object(packager, "MIB", 1024):
                source = self.directory / "limits.zip"
                output = self.directory / "limits.cindy"
                def write_source(payload_bytes):
                    with zipfile.ZipFile(source, "w") as bundle:
                        bundle.writestr("ghost.json", json.dumps({"node": {}} if node else {}))
                        bundle.writestr("payload.bin", bytes(payload_bytes))
                write_source(0)
                payload_bytes = limit * 1024 - source.stat().st_size
                write_source(payload_bytes)
                packager.assemble(source, output)
                self.assertEqual(output.stat().st_size, limit * 1024)
                write_source(payload_bytes + 1)
                with self.assertRaisesRegex(ValueError, "archive exceeds size limit"):
                    packager.assemble(source, output)

    def test_legacy_bytes_and_complete_package(self):
        source = self.source()
        output = self.directory / "result.cindy"
        with patch.object(packager, "download", side_effect=AssertionError("legacy must not download")):
            packager.assemble(source, output)
        self.assertEqual(source.read_bytes(), output.read_bytes())
        source = self.source(config())
        with patch.object(packager, "download", side_effect=lambda _, dest: dest.write_bytes(CONTENT)) as download:
            packager.assemble(source, output)
        self.assertEqual(download.call_count, 6)
        with zipfile.ZipFile(output) as bundle:
            for platform in packager.PLATFORMS:
                name = f"vendor/example-cli/{platform}/tool"
                self.assertEqual(bundle.read(name), CONTENT)
                self.assertEqual((bundle.getinfo(name).external_attr >> 16) & 0o777, 0o755)
            self.assertEqual(json.loads(bundle.read(packager.CONFIG)), config())
        first = output.read_bytes()
        with patch.object(packager, "download", side_effect=lambda _, dest: dest.write_bytes(CONTENT)):
            packager.assemble(source, output)
        self.assertEqual(first, output.read_bytes())

    def test_portable_resource_is_downloaded_and_packaged_once(self):
        declaration = config()
        declaration["dependencies"][0]["assets"] = [{
            "url": "https://downloads.example.com/v1.2.3/shared.wasm",
            "sha256": hashlib.sha256(CONTENT).hexdigest(), "format": "file",
            "files": [{"target": "vendor/example-cli/shared.wasm"}],
        }]
        output = self.directory / "portable.cindy"
        with patch.object(packager, "download", side_effect=lambda _, dest: dest.write_bytes(CONTENT)) as download:
            packager.assemble(self.source(declaration), output)
        self.assertEqual(download.call_count, 1)
        with zipfile.ZipFile(output) as bundle:
            self.assertEqual(bundle.read("vendor/example-cli/shared.wasm"), CONTENT)
            self.assertEqual([name for name in bundle.namelist() if name.startswith("vendor/")], ["vendor/example-cli/shared.wasm"])

    def test_multi_platform_archives_are_downloaded_once_each(self):
        all_platforms = sorted(packager.PLATFORMS)
        groupings = [
            [all_platforms],
            [[p for p in all_platforms if p.startswith(system)] for system in ("darwin", "linux", "windows")],
        ]
        for groups in groupings:
            with self.subTest(archives=len(groups)):
                declaration = config()
                assets = []
                payloads = {}
                for index, platforms in enumerate(groups):
                    buffer = io.BytesIO()
                    with zipfile.ZipFile(buffer, "w") as bundle:
                        for platform in platforms:
                            bundle.writestr(f"bin/{platform}/tool", platform.encode())
                    url = f"https://downloads.example.com/v1.2.3/archive-{index}.zip"
                    payloads[url] = buffer.getvalue()
                    assets.append({"url": url, "sha256": hashlib.sha256(buffer.getvalue()).hexdigest(),
                                   "format": "zip", "platforms": platforms,
                                   "files": [{"source": f"bin/{p}/tool", "target": f"vendor/example-cli/{p}/tool"} for p in platforms]})
                declaration["dependencies"][0]["assets"] = assets
                output = self.directory / "grouped.cindy"
                with patch.object(packager, "download", side_effect=lambda asset, dest: dest.write_bytes(payloads[asset["url"]])) as download:
                    packager.assemble(self.source(declaration), output)
                self.assertEqual(download.call_count, len(groups))
                with zipfile.ZipFile(output) as bundle:
                    for platform in all_platforms:
                        self.assertEqual(bundle.read(f"vendor/example-cli/{platform}/tool"), platform.encode())

    def test_failure_preserves_existing_output(self):
        source = self.source(config())
        source_bytes = source.read_bytes()
        output = self.directory / "existing.cindy"
        output.write_bytes(b"previous good package")
        def archive(command, **_):
            filename = next(arg.removeprefix("--output=") for arg in command if arg.startswith("--output="))
            Path(filename).write_bytes(source_bytes)
        with patch.object(packager.subprocess, "run", side_effect=archive), patch.object(packager, "download", side_effect=ValueError("SHA-256 mismatch")):
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                packager.package_plugin("fixture", output)
        self.assertEqual(output.read_bytes(), b"previous good package")
        self.assertEqual(list(self.directory.glob(".cindy-package-*")), [])

    def test_optional_brotli_encoding_and_flat_output_paths(self):
        declaration = config()
        for asset in declaration["dependencies"][0]["assets"]:
            platform = asset["platforms"][0]
            asset["files"][0] = {"target": f"vendor/example-cli/{platform}.br", "encoding": "brotli"}
        self.validate(declaration)
        source = self.source(declaration)
        output = self.directory / "encoded.cindy"
        logs = io.StringIO()
        with redirect_stdout(logs), patch.object(packager, "download", side_effect=lambda _, dest: dest.write_bytes(CONTENT)):
            packager.assemble(source, output)
        events = [json.loads(line.removeprefix("[timing] ")) for line in logs.getvalue().splitlines()
                  if line.startswith("[timing] ")]
        for stage in ("download_verify", "extract", "brotli", "zip_dependency"):
            stages = [event for event in events if event["stage"] == stage]
            self.assertEqual(len(stages), 6)
            self.assertEqual([event["asset"] for event in stages], list(range(1, 7)))
        self.assertEqual(events[-1]["stage"], "assemble_total")
        self.assertTrue(all(event["status"] == "ok" and event["elapsed_s"] >= 0 for event in events))
        self.assertNotIn("https://", logs.getvalue())
        expected = subprocess.check_output(["node", "-e",
            "const z=require('node:zlib');process.stdout.write(z.brotliCompressSync(require('node:fs').readFileSync(0),"
            "{params:{[z.constants.BROTLI_PARAM_QUALITY]:11}}))"], input=CONTENT)
        with zipfile.ZipFile(output) as bundle:
            for platform in packager.PLATFORMS:
                name = f"vendor/example-cli/{platform}.br"
                self.assertEqual(bundle.read(name), expected)
                decoded = subprocess.check_output(["node", "-e",
                    "process.stdout.write(require('node:zlib').brotliDecompressSync(require('node:fs').readFileSync(0)))"],
                    input=bundle.read(name))
                self.assertEqual(decoded, CONTENT)
                self.assertEqual((bundle.getinfo(name).external_attr >> 16) & 0o777, 0o644)
        item = declaration["dependencies"][0]["assets"][0]["files"][0]
        item["encoding"] = "shell"
        with self.assertRaisesRegex(ValueError, "encodings"):
            self.validate(declaration)
        item.update(encoding="brotli", executable=True)
        with self.assertRaisesRegex(ValueError, "not be marked executable"):
            self.validate(declaration)
        item.pop("executable")
        item["target"] = "vendor/example-cli/darwin-x64.br"
        with self.assertRaisesRegex(ValueError, "conflicting"):
            self.validate(declaration)

    def test_timing_uses_monotonic_clock_and_reports_failure_without_exception_details(self):
        logs = io.StringIO()
        with redirect_stdout(logs), patch.object(packager.time, "monotonic", side_effect=[10, 12.5]):
            with self.assertRaisesRegex(ValueError, "private detail"):
                with packager.timed_stage("download_verify", dependency="fixture", asset=1):
                    raise ValueError("private detail")
        event = json.loads(logs.getvalue().removeprefix("[timing] "))
        self.assertEqual(event, {"stage": "download_verify", "dependency": "fixture", "asset": 1,
                                 "status": "failed", "elapsed_s": 2.5})
        self.assertNotIn("private detail", logs.getvalue())

    def test_final_package_resolves_collected_manifest_reference(self):
        source = self.source(config())
        output = self.directory / "final.cindy"
        # A declared file may be absent from Git only if supplied by collection.
        with zipfile.ZipFile(source) as original:
            entries = {name: original.read(name) for name in original.namelist()}
        for entry, valid in [("vendor/example-cli/linux-x64/tool", True), ("missing.cjs", False)]:
            entries["ghost.json"] = json.dumps({"node": {"entry": entry}}).encode()
            with zipfile.ZipFile(source, "w") as bundle:
                for name, content in entries.items():
                    bundle.writestr(name, content)
            with patch.object(packager, "download", side_effect=lambda _, dest: dest.write_bytes(CONTENT)):
                if valid:
                    packager.assemble(source, output)
                else:
                    with self.assertRaisesRegex(ValueError, "Declared file missing"):
                        packager.assemble(source, output)

    def fixture_repository(self):
        repository = self.directory / "fixture-repo"
        repository.mkdir()
        def git(*args):
            return subprocess.check_output(["git", *args], cwd=repository, text=True).strip()
        git("init", "-q")
        git("config", "user.name", "Fixture")
        git("config", "user.email", "fixture@example.test")
        for name in packager.LEGAL_FILES:
            (repository / name).write_text("Fixture legal document\n")
        plugin = repository / "fixture"
        plugin.mkdir()
        (plugin / "ghost.json").write_text('{"entry":"main.js"}')
        (plugin / "main.js").write_text("// Packaging fixture only; never installed or executed.\n")
        return repository, plugin, git

    def test_shell_entry_keeps_small_tracked_binaries_without_python(self):
        repository, plugin, git = self.fixture_repository()
        small = plugin / "small.bin"
        small.write_bytes(b"\x00\xff" * (3 * packager.MIB))  # 6 MiB is allowed in Git.
        git("add", ".")
        git("-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture")
        # Neither an untracked declaration nor an unavailable Python may change
        # a legacy package. Fail loudly if the wrapper tries to invoke Python.
        (plugin / packager.CONFIG).write_text("untracked declaration must be ignored")
        shims = self.directory / "shims"
        shims.mkdir()
        python = shims / "python3"
        python.write_text("#!/bin/sh\necho 'unexpected Python invocation' >&2\nexit 99\n")
        python.chmod(0o755)
        output = self.directory / "legacy.cindy"
        subprocess.run(["bash", str(ROOT / ".github/scripts/package-plugin.sh"), "fixture", str(output)],
                       cwd=repository, env={**os.environ, "PATH": f"{shims}{os.pathsep}{os.environ['PATH']}"}, check=True)
        with zipfile.ZipFile(output) as bundle:
            self.assertEqual(bundle.read("small.bin"), small.read_bytes())
            self.assertNotIn(packager.CONFIG, bundle.namelist())

    @unittest.skipUnless(os.environ.get("CINDY_BINARY_LIVE_SMOKE") == "1", "opt-in public-network packaging smoke")
    def test_live_public_download_through_shell_entry(self):
        repository, plugin, git = self.fixture_repository()
        # Platform-independent WebAssembly fixture, pinned to a reviewed MDN
        # commit and CC0 license. No Google plugin, native execution or install.
        base = "https://raw.githubusercontent.com/mdn/webassembly-examples/e2ec80aa2d729c04a06666c791a1379be73c5af5"
        digest = "e2ffbd2e69e28876a64f8f4e3175b1f367033d3252fb0111e2ba74c000dc28b8"
        packager.download({"url": base + "/LICENSE", "sha256": "36ffd9dc085d529a7e60e1276d73ae5a030b020313e6c5408593a6ae2af39673"}, plugin / "THIRD-PARTY-LICENSES.txt")
        declaration = config()
        dependency = declaration["dependencies"][0]
        dependency["version"] = "e2ec80aa2d729c04a06666c791a1379be73c5af5"
        dependency["assets"] = [{
            "url": base + "/js-api-examples/simple.wasm", "sha256": digest, "format": "file",
            "files": [{"target": "vendor/example-cli/simple.wasm"}],
        }]
        (plugin / packager.CONFIG).write_text(json.dumps(declaration))
        git("add", ".")
        git("-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture")
        (plugin / "untracked.txt").write_text("must not be packaged")
        output = self.directory / "live.cindy"
        subprocess.run(["bash", str(ROOT / ".github/scripts/package-plugin.sh"), "fixture", str(output)], cwd=repository, check=True)
        with zipfile.ZipFile(output) as bundle:
            self.assertNotIn("untracked.txt", bundle.namelist())
            content = bundle.read("vendor/example-cli/simple.wasm")
            self.assertTrue(content.startswith(b"\x00asm"))
            self.assertEqual(hashlib.sha256(content).hexdigest(), digest)
            self.assertEqual([name for name in bundle.namelist() if name.startswith("vendor/")], ["vendor/example-cli/simple.wasm"])
            self.assertEqual(bundle.read("THIRD-PARTY-LICENSES.txt"), (plugin / "THIRD-PARTY-LICENSES.txt").read_bytes())
        print(f"Live smoke: verified one shared resource in {output.stat().st_size}-byte package", flush=True)

    def test_zip_and_tar_selection_reject_unsafe_members(self):
        asset = {"format": "zip", "files": [{"source": "bin/tool", "target": "unused"}]}
        archive = self.directory / "asset.zip"
        with zipfile.ZipFile(archive, "w") as bundle:
            bundle.writestr("bin/tool", CONTENT)
            bundle.writestr("not-selected.txt", "ignored")
        result = packager.selected_files(asset, archive, self.directory)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0][1].read_bytes(), CONTENT)
        for name, mode in [("../outside", stat.S_IFREG), ("link", stat.S_IFLNK)]:
            with zipfile.ZipFile(archive, "w") as bundle:
                entry = zipfile.ZipInfo(name)
                entry.external_attr = (mode | 0o644) << 16
                bundle.writestr(entry, "bin/tool")
            with self.subTest(name=name), self.assertRaises(ValueError):
                packager.selected_files(asset, archive, self.directory)
        with zipfile.ZipFile(archive, "w") as bundle:
            bundle.writestr("other", "not selected")
        with self.assertRaisesRegex(ValueError, "Missing"):
            packager.selected_files(asset, archive, self.directory)
        asset["format"] = "tar.gz"
        for kind in [tarfile.REGTYPE, tarfile.SYMTYPE, tarfile.LNKTYPE]:
            with tarfile.open(archive, "w:gz") as bundle:
                entry = tarfile.TarInfo("./bin/tool")
                entry.type = kind
                entry.size = len(CONTENT) if kind == tarfile.REGTYPE else 0
                entry.linkname = "other" if kind != tarfile.REGTYPE else ""
                bundle.addfile(entry, io.BytesIO(CONTENT) if kind == tarfile.REGTYPE else None)
            if kind == tarfile.REGTYPE:
                self.assertEqual(packager.selected_files(asset, archive, self.directory)[0][1].read_bytes(), CONTENT)
                with patch.object(packager, "MAX_EXPANDED", 8), self.assertRaisesRegex(ValueError, "size limit"):
                    packager.selected_files(asset, archive, self.directory)
            else:
                with self.assertRaises(ValueError):
                    packager.selected_files(asset, archive, self.directory)

    def test_download_hash_redirect_and_public_address(self):
        asset = config()["dependencies"][0]["assets"][0]
        class Response(io.BytesIO):
            status = 200
            def getheader(self, name, default=None):
                return str(len(CONTENT)) if name == "Content-Length" else default
        connection = unittest.mock.MagicMock()
        connection.getresponse.side_effect = [Response(CONTENT), Response(CONTENT)]
        destination = self.directory / "download"
        with patch.object(packager, "PublicHTTPSConnection", return_value=connection):
            packager.download(asset, destination)
            self.assertEqual(destination.read_bytes(), CONTENT)
            asset["sha256"] = "0" * 64
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                packager.download(asset, destination)
        class Redirect(Response):
            status = 302
            def getheader(self, name, default=None):
                return "http://127.0.0.1/secret" if name == "Location" else default
        connection.getresponse.side_effect = [Redirect()]
        with patch.object(packager, "PublicHTTPSConnection", return_value=connection), self.assertRaisesRegex(ValueError, "HTTPS"):
            packager.download(asset, destination)
        for address in ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1"]:
            resolved = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, 443))]
            with patch.object(packager.socket, "getaddrinfo", return_value=resolved), self.assertRaisesRegex(ValueError, "non-public"):
                packager.public_addresses("downloads.example.com")
        resolved = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 443))]
        with patch.object(packager.socket, "getaddrinfo", return_value=resolved):
            self.assertEqual(packager.public_addresses("downloads.example.com"), resolved)

    def test_trickling_download_rechecks_transfer_deadline(self):
        clock = [0]
        class Response:
            status = 200
            def getheader(self, name, default=None):
                return default
            def read(self, size):
                raise AssertionError("A filling read can hide progress past the deadline")
            def read1(self, size):
                clock[0] += 1
                return b"x"
        connection = unittest.mock.MagicMock()
        connection.getresponse.return_value = Response()
        destination = self.directory / "slow-download"
        with patch.object(packager, "PublicHTTPSConnection", return_value=connection), \
             patch.object(packager.time, "monotonic", side_effect=lambda: clock[0]), \
             patch.object(packager, "TIMEOUT", 2):
            with self.assertRaisesRegex(ValueError, "download timed out"):
                packager.download(config()["dependencies"][0]["assets"][0], destination)
        self.assertEqual(destination.read_bytes(), b"xx")
        connection.close.assert_called_once()

    def test_source_gate_counts_binary_totals_per_plugin(self):
        repository = self.directory / "repo"
        repository.mkdir()
        def git(*args):
            return subprocess.check_output(["git", *args], cwd=repository, text=True).strip()
        git("init", "-q")
        git("config", "user.name", "Fixture")
        git("config", "user.email", "fixture@example.test")
        def commit():
            git("add", ".")
            git("-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture")
            return git("rev-parse", "HEAD")
        for plugin in ["legacy", "first", "second"]:
            (repository / plugin).mkdir()
            (repository / plugin / "ghost.json").write_text("{}")
        def binary(plugin, path, size, byte=b"\0"):
            target = repository / plugin / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(byte * size)
        def check(base, expected=True, plugin=None):
            result = subprocess.run(
                ["node", str(ROOT / ".github/scripts/check-source-size.mjs"), base],
                cwd=repository, capture_output=True, text=True,
            )
            if expected:
                self.assertEqual(result.returncode, 0, result.stderr)
            else:
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("10 MiB per-plugin total", result.stderr)
                self.assertIn(f'"{plugin}"', result.stderr)
        binary("legacy", "old.bin", 10 * packager.MIB + 1)
        binary("first", "darwin/tool", 4 * packager.MIB)
        base = commit()

        # Legacy source edits pass; large UTF-8 sources are not binaries even
        # with -text attributes, and text attributes cannot hide binary bytes.
        (repository / "legacy/readme.txt").write_text("source change")
        (repository / ".gitattributes").write_text("*.js -text\n*.bin text\n")
        (repository / "first/main.js").write_text("// 文本\n" * (2 * packager.MIB))
        binary("first", "windows/tool.bin", 6 * packager.MIB)
        binary("second", "linux/tool", 6 * packager.MIB)
        commit()
        # Exactly 10 MiB passes, with unchanged platform bytes included; the
        # other plugin's 6 MiB and untracked build inputs are not combined.
        binary("first", "downloaded/untracked.bin", 11 * packager.MIB)
        check(base)
        (repository / "first/downloaded/untracked.bin").unlink()

        # One extra byte on another platform tips the combined total over the
        # cap. Invalid UTF-8 is binary even without a NUL or filename extension.
        binary("first", "linux/tool", 1, b"\xff")
        commit()
        check(base, False, "first")
        (repository / "first/linux/tool").unlink()
        previous = commit()
        check(base)

        # Updating a legacy binary triggers its whole plugin's total, even
        # when the replacement itself is not larger than the old file.
        binary("legacy", "old.bin", 10 * packager.MIB + 1, b"\xff")
        oversized = commit()
        check(previous, False, "legacy")
        (repository / "legacy/old.bin").unlink()
        commit()
        check(oversized)

    def test_source_gate_new_plugin_checks_preexisting_binary_paths(self):
        repository = self.directory / "repo"
        repository.mkdir()
        def git(*args):
            return subprocess.check_output(["git", *args], cwd=repository, text=True).strip()
        git("init", "-q")
        git("config", "user.name", "Fixture")
        git("config", "user.email", "fixture@example.test")
        def commit():
            git("add", ".")
            git("-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture")
            return git("rev-parse", "HEAD")
        (repository / "new-plugin").mkdir()
        # A long text prefix cannot hide a binary tail from detection.
        (repository / "new-plugin/tool").write_bytes(b"x" * (10 * packager.MIB) + b"\0")
        base = commit()
        (repository / "new-plugin/ghost.json").write_text("{}")
        commit()
        result = subprocess.run(
            ["node", str(ROOT / ".github/scripts/check-source-size.mjs"), base],
            cwd=repository, capture_output=True, text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('"new-plugin"', result.stderr)
        self.assertIn("10 MiB per-plugin total", result.stderr)


if __name__ == "__main__":
    unittest.main()
