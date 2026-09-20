#!/usr/bin/env python3
"""Collect pinned binary assets into a plugin package; never execute plugin code.

Python 3.11+ standard library only. Build configuration comes from the same Git
archive as the plugin, not from the working tree. See docs/binary-dependencies.md.
"""

import argparse
import gzip
import hashlib
import http.client
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import socket
import ssl
import stat
import subprocess
import tarfile
import tempfile
import time
import unicodedata
from urllib.parse import urljoin, urlsplit
import zipfile


CONFIG = "binary-dependencies.json"
PLATFORMS = {f"{system}-{arch}" for system in ("darwin", "linux", "windows") for arch in ("x64", "arm64")}
LEGAL_FILES = ("LICENSE", "NOTICE", "TRADEMARKS.md", "TRADEMARKS.zh-CN.md")
MIB = 1024 * 1024
MAX_DOWNLOAD = 128 * MIB
MAX_EXPANDED = 256 * MIB
MAX_MEMBERS = 4096
MAX_CONFIG = 256 * 1024
TIMEOUT = 120


def require(condition, message):
    if not condition:
        raise ValueError(message)


def safe_path(value):
    require(isinstance(value, str) and 0 < len(value) <= 240, "Expected a relative file path (1-240 characters)")
    for segment in value.split("/"):
        require(segment not in ("", ".", "..", "__MACOSX"), f"Unsafe path: {value!r}")
        require(not re.search(r'[\x00-\x1f\x7f<>:"|?*\\]', segment), f"Unsafe path: {value!r}")
        require(not segment.endswith((" ", ".")), f"Unsafe path: {value!r}")
        require(not re.match(r"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", segment, re.I), f"Unsafe path: {value!r}")
    return value


def folded(value):
    return unicodedata.normalize("NFC", value).casefold()


def add_path(paths, name, directory=False):
    safe_path(name)
    key = folded(name)
    require(key not in paths, f"Duplicate/case-conflicting path: {name}")
    parts = key.split("/")
    for i in range(1, len(parts)):
        require(paths.get("/".join(parts[:i])) != "file", f"File/directory collision: {name}")
    if not directory:
        require(not any(p.startswith(key + "/") for p in paths), f"File/directory collision: {name}")
    paths[key] = "directory" if directory else "file"


def exact_keys(value, required, optional=()):
    require(isinstance(value, dict), "Expected an object")
    require(set(required) <= value.keys() <= set(required) | set(optional), f"Expected fields {sorted(required)}; optional {sorted(optional)}")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def parse_url(value):
    require(isinstance(value, str) and len(value) <= 4096 and not re.search(r"[\s\\\x00-\x1f\x7f]", value), "Invalid download URL")
    url = urlsplit(value)
    require(url.scheme == "https" and url.hostname and url.port in (None, 443), "Downloads require HTTPS port 443")
    require(not url.username and not url.password and not url.fragment, "URL credentials and fragments are forbidden")
    require(not url.hostname.endswith(".") and not url.hostname.endswith((".localhost", ".local", ".internal", ".test")), "Download host must be public")
    require(url.hostname != "localhost", "Download host must be public")
    return url


def validate_config(raw, package_paths):
    require(len(raw) <= MAX_CONFIG, "Binary dependency configuration exceeds 256 KiB")
    config = json.loads(raw, object_pairs_hook=unique_object)
    exact_keys(config, ("schemaVersion", "dependencies"))
    require(type(config["schemaVersion"]) is int and config["schemaVersion"] == 1, "Unsupported binary dependency schemaVersion")
    dependencies = config["dependencies"]
    require(isinstance(dependencies, list) and 1 <= len(dependencies) <= 16, "Expected 1-16 binary dependencies")
    names = set()
    destinations = dict(package_paths)
    for dependency in dependencies:
        exact_keys(dependency, ("name", "version", "license", "assets"))
        name = dependency["name"]
        require(isinstance(name, str) and re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", name), "Invalid dependency name")
        require(name not in names, f"Duplicate dependency: {name}")
        names.add(name)
        version = dependency["version"]
        require(isinstance(version, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]{0,63}", version) and version.lower() not in ("latest", "main", "master", "head"), "A fixed dependency version is required")
        license_path = safe_path(dependency["license"])
        require(package_paths.get(folded(license_path)) == "file", f"License must be a tracked package file: {license_path}")
        assets = dependency["assets"]
        require(isinstance(assets, list) and 1 <= len(assets) <= 32, "Expected 1-32 download assets")
        covered_platforms = set()
        for asset in assets:
            exact_keys(asset, ("url", "sha256", "format", "files"), ("platforms",))
            # One portable resource or one archive containing every target
            # needs one declaration. Split upstream releases declare their scope.
            platforms = asset.get("platforms", sorted(PLATFORMS))
            require(isinstance(platforms, list) and platforms and all(isinstance(p, str) and p in PLATFORMS for p in platforms), "Invalid asset platforms")
            require(len(set(platforms)) == len(platforms), "Duplicate asset platforms")
            covered_platforms.update(platforms)
            parse_url(asset["url"])
            require(isinstance(asset["sha256"], str) and re.fullmatch(r"[0-9a-f]{64}", asset["sha256"]), "Expected lowercase SHA-256")
            require(asset["format"] in ("file", "zip", "tar.gz"), "Supported formats: file, zip, tar.gz")
            files = asset["files"]
            require(isinstance(files, list) and 1 <= len(files) <= 32, "Expected 1-32 selected files per asset")
            require(asset["format"] != "file" or len(files) == 1, "A raw file has exactly one destination")
            sources = set()
            for item in files:
                exact_keys(item, ("target",) if asset["format"] == "file" else ("source", "target"), ("executable", "encoding"))
                require(type(item.get("executable", False)) is bool, "executable must be a boolean")
                require(item.get("encoding", "identity") in ("identity", "brotli"), "Supported output encodings: identity, brotli")
                require(item.get("encoding") != "brotli" or not item.get("executable", False), "Encoded data must not be marked executable")
                target = safe_path(item["target"])
                require(target.startswith(f"vendor/{name}/"), f"Dependency output must stay under vendor/{name}/")
                add_path(destinations, target)
                if "source" in item:
                    source = safe_path(item["source"])
                    require(source not in sources, f"Duplicate selected source: {source}")
                    sources.add(source)
        require(covered_platforms == PLATFORMS, f"{name}: missing platforms: {', '.join(sorted(PLATFORMS - covered_platforms))}")
    return dependencies


def public_addresses(host):
    addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    require(addresses, "Download host has no address")
    for _, _, _, _, address in addresses:
        ip = ipaddress.ip_address(address[0])
        require(ip.is_global and not ip.is_multicast and not ip.is_reserved and not getattr(ip, "ipv4_mapped", None) and not getattr(ip, "sixtofour", None) and not getattr(ip, "teredo", None), "Download host resolves to a non-public address")
    return addresses


class PublicHTTPSConnection(http.client.HTTPSConnection):
    """Pin the validated address, while verifying TLS/SNI against the URL host."""

    def connect(self):
        addresses = public_addresses(self.host)
        family, kind, protocol, _, address = addresses[0]
        sock = socket.socket(family, kind, protocol)
        sock.settimeout(self.timeout)
        try:
            sock.connect(address)
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
        except BaseException:
            sock.close()
            raise


def download(asset, destination):
    url_text = asset["url"]
    deadline = time.monotonic() + TIMEOUT
    for _ in range(6):
        url = parse_url(url_text)
        remaining = deadline - time.monotonic()
        require(remaining > 0, "Dependency download timed out")
        # No proxy, netrc, cookies, ambient auth or automatic redirects.
        connection = PublicHTTPSConnection(url.hostname, timeout=min(30, remaining), context=ssl.create_default_context())
        try:
            target = url.path or "/"
            if url.query:
                target += "?" + url.query
            connection.request("GET", target, headers={"User-Agent": "Cindy-plugin-packager/1", "Accept-Encoding": "identity"})
            response = connection.getresponse()
            if response.status in (301, 302, 303, 307, 308):
                location = response.getheader("Location")
                require(location, "Redirect is missing Location")
                url_text = urljoin(url_text, location)
                continue
            require(response.status == 200, f"Dependency download returned HTTP {response.status}")
            require(response.getheader("Content-Encoding", "identity") == "identity", "Unexpected HTTP content encoding")
            size = response.getheader("Content-Length")
            require(size is None or (size.isdecimal() and int(size) <= MAX_DOWNLOAD), "Dependency download exceeds 128 MiB")
            digest = hashlib.sha256()
            count = 0
            with destination.open("wb") as output:
                while True:
                    require(time.monotonic() < deadline, "Dependency download timed out")
                    # Do not wait to fill the buffer: a trickling peer could
                    # keep read(n) alive past the transfer deadline indefinitely.
                    chunk = response.read1(64 * 1024)
                    if not chunk:
                        break
                    count += len(chunk)
                    require(count <= MAX_DOWNLOAD, "Dependency download exceeds 128 MiB")
                    digest.update(chunk)
                    output.write(chunk)
            require(count > 0 and (size is None or count == int(size)), "Empty or incomplete dependency download")
            require(digest.hexdigest() == asset["sha256"], "Dependency SHA-256 mismatch")
            return
        finally:
            connection.close()
    raise ValueError("Too many dependency redirects")


def copy_bounded(source, destination, limit):
    size = 0
    while True:
        chunk = source.read(64 * 1024)
        if not chunk:
            return size
        size += len(chunk)
        require(size <= limit, "Expanded dependency exceeds size limit")
        destination.write(chunk)


def selected_files(asset, archive, output_dir):
    """Read members into numbered temporary files; never extract archive paths."""
    selected = {item.get("source", ""): item for item in asset["files"]}
    result = []
    seen = {}
    total = 0
    members = 0

    def consume(name, size, directory, regular, opener):
        nonlocal total, members
        members += 1
        require(members <= MAX_MEMBERS, "Dependency archive has too many entries")
        if directory and name in (".", "./"):
            return
        # Common tar producers prefix paths with ./; do not normalize traversal.
        if name.startswith("./"):
            name = name[2:]
        name = name.rstrip("/") if directory else name
        add_path(seen, name, directory)
        require(directory or regular, f"Links and special archive entries are forbidden: {name}")
        require(size >= 0, "Invalid archive member size")
        total += size
        require(total <= MAX_EXPANDED, "Dependency archive expands beyond 256 MiB")
        if name not in selected:
            return
        require(regular and not directory, f"Selected member is not a regular file: {name}")
        item = selected.pop(name)
        target = output_dir / str(len(result))
        with opener() as source, target.open("wb") as output:
            require(copy_bounded(source, output, min(size, MAX_EXPANDED)) == size, f"Truncated member: {name}")
        result.append((item, target))

    if asset["format"] == "file":
        require(archive.stat().st_size <= MAX_DOWNLOAD, "Dependency file exceeds download size limit")
        return [(asset["files"][0], archive)]
    if asset["format"] == "zip":
        with zipfile.ZipFile(archive) as bundle:
            for info in bundle.infolist():
                mode = info.external_attr >> 16
                require(not info.flag_bits & 1, "Encrypted ZIP entries are forbidden")
                require(stat.S_IFMT(mode) in (0, stat.S_IFREG, stat.S_IFDIR), "Links and special ZIP entries are forbidden")
                consume(info.filename, info.file_size, info.is_dir(), stat.S_IFMT(mode) in (0, stat.S_IFREG), lambda i=info: bundle.open(i))
    else:
        # Bound the entire gzip stream, including padding and tar metadata,
        # before tarfile parses long-name/PAX headers.
        unpacked = output_dir / "archive.tar"
        with gzip.open(archive, "rb") as source, unpacked.open("wb") as output:
            copy_bounded(source, output, MAX_EXPANDED)
        with tarfile.open(unpacked, "r:") as bundle:
            for info in bundle:
                consume(info.name, info.size, info.isdir(), info.isfile() and not info.issparse(), lambda i=info: bundle.extractfile(i))
    require(not selected, f"Missing dependency files: {', '.join(selected)}")
    return result


def inspect_package(bundle, *, final=False):
    paths = {}
    total = 0
    require(len(bundle.infolist()) <= 256, "Plugin package exceeds 256 entries")
    for info in bundle.infolist():
        mode = info.external_attr >> 16
        require(stat.S_IFMT(mode) in (0, stat.S_IFREG, stat.S_IFDIR), "Plugin package contains a link or special file")
        require(not info.flag_bits & 1, "Encrypted plugin files are forbidden")
        name = info.filename.rstrip("/") if info.is_dir() else info.filename
        add_path(paths, name, info.is_dir())
        total += info.file_size
    require(bundle.getinfo("ghost.json").file_size <= MAX_CONFIG, "Manifest exceeds 256 KiB")
    manifest = json.loads(bundle.read("ghost.json"))
    require(isinstance(manifest, dict), "Manifest must be an object")
    node = manifest.get("node") is not None
    require(total <= (256 if node else 32) * MIB, "Plugin package exceeds expanded size limit")
    require(not ({".disabled", ".cindy-trust.json", "cindy-signatures.json"} & paths.keys()), "Plugin package contains reserved files")
    if final:
        # Source checks may defer explicitly collected references until assembly.
        # Re-check exact paths in the final package, not just the Git snapshot.
        references = [manifest.get("entry"), manifest.get("settingsHtml"), manifest.get("icon")]
        for field in ("panel", "mainView"):
            references.append((manifest.get(field) or {}).get("html"))
        if node:
            references.append(manifest["node"].get("entry"))
            references.extend(manifest["node"].get("entries", []))
        for name in filter(None, references):
            safe_path(name)
            require(name in bundle.namelist() and not bundle.getinfo(name).is_dir(), f"Declared file missing from final package: {name}")
            if name == manifest.get("icon"):
                require(0 < bundle.getinfo(name).file_size <= 512 * 1024, "Final package icon must be nonempty and at most 512 KiB")
    return paths, node, total


def assemble(source, destination):
    with zipfile.ZipFile(source) as bundle:
        paths, node, total = inspect_package(bundle)
        require(source.stat().st_size <= (128 if node else 8) * MIB, "Plugin archive exceeds size limit")
        if CONFIG not in bundle.namelist():
            shutil.copyfile(source, destination)  # Preserve legacy archive bytes.
            return
        require(bundle.getinfo(CONFIG).file_size <= MAX_CONFIG, "Binary dependency configuration exceeds 256 KiB")
        dependencies = validate_config(bundle.read(CONFIG), paths)
        require(paths.get(folded("THIRD-PARTY-LICENSES.txt")) == "file", "Binary dependencies require THIRD-PARTY-LICENSES.txt")
        for dependency in dependencies:
            require(bundle.getinfo(dependency["license"]).file_size > 0, "Dependency license cannot be empty")
        count = len(bundle.infolist())
        timestamp = bundle.getinfo("ghost.json").date_time
        with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
            for info in bundle.infolist():
                output.writestr(info, bundle.read(info))
            for dependency in dependencies:
                for index, asset in enumerate(dependency["assets"], start=1):
                    print(f"Collecting {dependency['name']} {dependency['version']} (asset {index})", flush=True)
                    with tempfile.TemporaryDirectory(prefix="cindy-binary-") as temp:
                        temp_path = Path(temp)
                        archive = temp_path / "download"
                        download(asset, archive)
                        for item, file in selected_files(asset, archive, temp_path):
                            if item.get("encoding") == "brotli":
                                encoded = temp_path / (file.name + ".br")
                                subprocess.run(["node", str(Path(__file__).with_name("brotli-file.mjs")),
                                                str(file), str(encoded)], check=True, timeout=300)
                                file = encoded
                            total += file.stat().st_size
                            count += 1
                            require(total <= (256 if node else 32) * MIB and count <= 256, "Collected files exceed plugin package limits")
                            info = zipfile.ZipInfo(item["target"], timestamp)
                            info.create_system = 3
                            info.compress_type = zipfile.ZIP_DEFLATED
                            info.external_attr = (stat.S_IFREG | (0o755 if item.get("executable") else 0o644)) << 16
                            with file.open("rb") as content, output.open(info, "w") as member:
                                shutil.copyfileobj(content, member)
        require(destination.stat().st_size <= (128 if node else 8) * MIB, "Collected archive exceeds package size limit")
        with zipfile.ZipFile(destination) as output:
            inspect_package(output, final=True)


def package_plugin(plugin, output):
    safe_path(plugin)
    require(not plugin.startswith("-"), "Invalid plugin directory")
    output = Path(output).absolute()
    require(output.suffix == ".cindy", "Output must end in .cindy")
    # TemporaryDirectory removes partial downloads/archives on any failure;
    # an existing output is replaced only after the complete package passes.
    with tempfile.TemporaryDirectory(prefix=".cindy-package-", dir=output.parent) as temp:
        temp_path = Path(temp)
        source = temp_path / "source.zip"
        subprocess.run(["git", "-c", "core.autocrlf=false", "archive", "--format=zip", f"--output={source}",
                        *(f"--add-file={name}" for name in LEGAL_FILES), f"HEAD:{plugin}"], check=True)
        assembled = temp_path / "plugin.cindy"
        assemble(source, assembled)
        os.replace(assembled, output)
    print(f"Packaged {plugin}: {output} ({output.stat().st_size} bytes)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plugin_directory")
    parser.add_argument("output_file")
    args = parser.parse_args()
    try:
        package_plugin(args.plugin_directory, args.output_file)
    except (ValueError, OSError, KeyError, zipfile.BadZipFile, tarfile.TarError, http.client.HTTPException, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        parser.exit(1, f"Packaging failed: {error}\n")
