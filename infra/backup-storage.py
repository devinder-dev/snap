"""Transfer a single fixed backup object using curl's S3 signature support."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import quote, urlencode, urlsplit
from xml.etree import ElementTree

LIMIT = 256 * 1024 * 1024


def checksum(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def transfer(settings, method, url, options=()):
    # curl reads credentials from stdin, away from command arguments and logs.
    auth = settings["ACCESS_KEY_ID"] + ":" + settings["SECRET_ACCESS_KEY"]
    config = "user = " + json.dumps(auth) + "\n"
    result = subprocess.run(
        ["curl", "--disable", "--config", "-", "--silent", "--fail",
         "--globoff", "--noproxy", "*", "--connect-timeout", "10", "--max-time", "300",
         "--write-out", "\n%{http_code}",
         "--aws-sigv4", f"aws:amz:{settings['REGION']}:s3",
         "--request", method, *options, "--url", url],
        input=config.encode(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False,
    )
    if result.returncode:
        raise SystemExit(f"Backup storage: {method} failed (curl exit {result.returncode})")
    body, _, status = result.stdout.rpartition(b"\n")
    if not re.fullmatch(rb"2[0-9]{2}", status):
        raise SystemExit(f"Backup storage: {method} did not return a success status")
    return body


def main():
    config = Path(sys.argv[1])
    if config.stat().st_mode & 0o077:
        raise SystemExit("Backup storage: credentials file must be private")
    settings = dict(line.split("=", 1) for line in config.read_text().splitlines()
                    if line.strip() and not line.lstrip().startswith("#"))
    endpoint = urlsplit(settings["ENDPOINT"])
    loopback = endpoint.scheme == "http" and endpoint.hostname in {"127.0.0.1", "::1"}
    if (not (endpoint.scheme == "https" or loopback) or not endpoint.hostname
            or endpoint.username or endpoint.password or endpoint.path not in ("", "/")
            or endpoint.query or endpoint.fragment):
        raise SystemExit("Backup storage: use an HTTPS endpoint or a loopback test endpoint")
    bucket = settings["BUCKET"]
    key = settings.get("OBJECT", "snap/postgres.dump")
    if not re.fullmatch(r"[A-Za-z0-9_-]+(?:/[A-Za-z0-9_.-]+)*", key) or any(
        segment in (".", "..") for segment in key.split("/")
    ):
        raise SystemExit("Backup storage: invalid object name")
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]+", bucket):
        raise SystemExit("Backup storage: invalid bucket name")
    bucket_url = f"{endpoint.scheme}://{endpoint.netloc}/{bucket}"
    object_url = f"{bucket_url}/{quote(key)}"
    operation = sys.argv[2]

    if operation == "versions":
        query = {"prefix": key}
        while True:
            xml = transfer(settings, "GET", f"{bucket_url}/?versions=&{urlencode(query)}")
            root = ElementTree.fromstring(xml)
            if root.tag.split("}")[-1] != "ListVersionsResult":
                raise SystemExit("Backup storage: endpoint did not return a version list")
            for entry in root.findall("{*}Version"):
                if entry.findtext("{*}Key") == key:
                    print(entry.findtext("{*}VersionId"), entry.findtext("{*}LastModified"),
                          "latest" if entry.findtext("{*}IsLatest") == "true" else "")
            if root.findtext("{*}IsTruncated") != "true":
                return
            query["key-marker"] = root.findtext("{*}NextKeyMarker")
            query["version-id-marker"] = root.findtext("{*}NextVersionIdMarker")
            if not query["key-marker"]:
                raise SystemExit("Backup storage: version list omitted its next page marker")

    path = Path(sys.argv[3])
    if operation == "upload":
        size = path.stat().st_size
        if not 0 < size <= LIMIT:
            raise SystemExit("Backup storage: dump is empty or exceeds the 256 MiB limit")
        digest = checksum(path)
        transfer(settings, "PUT", object_url, [
            "--upload-file", str(path), "--header", f"x-amz-content-sha256: {digest}",
            "--header", f"x-amz-meta-sha256: {digest}", "--output", os.devnull,
        ])
    elif operation == "download":
        if len(sys.argv) == 5:
            object_url += "?" + urlencode({"versionId": sys.argv[4]}, quote_via=quote)
        headers = transfer(settings, "GET", object_url, [
            "--max-filesize", str(LIMIT), "--output", str(path), "--dump-header", "-",
        ])
        digests = re.findall(rb"(?im)^x-amz-meta-sha256:\s*([a-f0-9]{64})\s*$", headers)
        size = path.stat().st_size
        digest = checksum(path)
        if digests != [digest.encode()] or not 0 < size <= LIMIT:
            raise SystemExit("Backup storage: download checksum or size did not match")
    else:
        raise SystemExit("Backup storage: unsupported operation")
    print(f"{operation}: {size} bytes, sha256 {digest}")


if __name__ == "__main__":
    try:
        main()
    except (IndexError, KeyError, OSError, ValueError, ElementTree.ParseError):
        # An exception message could contain a credential or a response body.
        raise SystemExit("Backup storage: invalid settings, file, or response") from None
