#!/usr/bin/env python3
"""Filter google-10000-english.txt down to words WordNet can actually resolve.

One-time, offline build step. Intersects the frequency-ordered google list with
the set of WordNet lemmas (from Princeton WordNet 3.1 index files) and writes the
survivors, preserving frequency order, to words_wn.txt — which dict.rs embeds.

Cacheable at every layer:
  * tarball download -> .cache/ (skipped if already present)
  * extracted lemmas -> .cache/wn-lemmas.txt, keyed by tarball sha256
  * output write     -> only if content actually changed

Usage:
    python3 filter_wordlist.py [--refresh] [WORDNET_TARBALL_URL]

The app build itself needs no network: words_wn.txt is committed. This script
only regenerates it.
"""

import hashlib
import os
import sys
import tarfile
import tempfile
import urllib.request

DEFAULT_URL = "https://wordnetcode.princeton.edu/wn3.1.dict.tar.gz"
INDEX_MEMBERS = ("index.noun", "index.verb", "index.adj", "index.adv")

HERE = os.path.dirname(os.path.abspath(__file__))
PROVIDERS = os.path.join(HERE, "..", "src", "providers")
SRC_LIST = os.path.join(PROVIDERS, "google-10000-english.txt")
OUT_LIST = os.path.join(PROVIDERS, "words_wn.txt")
CACHE = os.path.join(HERE, ".cache")
TARBALL = os.path.join(CACHE, "wn3.1.dict.tar.gz")
LEMMAS_CACHE = os.path.join(CACHE, "wn-lemmas.txt")
HASH_CACHE = os.path.join(CACHE, "wn.sha256")


def log(msg):
    print(f"[filter_wordlist] {msg}")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure_tarball(url, refresh):
    os.makedirs(CACHE, exist_ok=True)
    if refresh and os.path.exists(TARBALL):
        os.remove(TARBALL)
    if os.path.exists(TARBALL):
        log(f"tarball cached ({os.path.getsize(TARBALL)} bytes), skipping download")
        return
    log(f"downloading {url}")
    # Download to a temp file then rename, so an interrupted run leaves no
    # half-written tarball masquerading as a valid cache entry.
    fd, tmp = tempfile.mkstemp(dir=CACHE)
    os.close(fd)
    try:
        urllib.request.urlretrieve(url, tmp)
        os.replace(tmp, TARBALL)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise
    log(f"downloaded {os.path.getsize(TARBALL)} bytes")


def extract_lemmas():
    """Return the WordNet lemma set, using the on-disk cache when the tarball
    hash is unchanged."""
    digest = sha256(TARBALL)
    cached_digest = None
    if os.path.exists(HASH_CACHE):
        with open(HASH_CACHE) as f:
            cached_digest = f.read().strip()
    if cached_digest == digest and os.path.exists(LEMMAS_CACHE):
        with open(LEMMAS_CACHE) as f:
            lemmas = {line.strip() for line in f if line.strip()}
        log(f"lemma cache hit ({len(lemmas)} lemmas)")
        return lemmas

    log("extracting lemmas from tarball")
    lemmas = set()
    with tarfile.open(TARBALL, "r:gz") as tf:
        for member in tf.getmembers():
            base = os.path.basename(member.name)
            if base not in INDEX_MEMBERS:
                continue
            f = tf.extractfile(member)
            if f is None:
                continue
            for raw in f:
                line = raw.decode("latin-1")
                # License header lines begin with a space; data lines don't.
                if line.startswith(" "):
                    continue
                token = line.split(" ", 1)[0].lower()
                # Single alphabetic tokens only (drop multiword "a_b", digits).
                if token.isalpha():
                    lemmas.add(token)
    with open(LEMMAS_CACHE, "w") as f:
        f.write("\n".join(sorted(lemmas)))
    with open(HASH_CACHE, "w") as f:
        f.write(digest)
    log(f"extracted {len(lemmas)} lemmas (cached)")
    return lemmas


def main():
    args = [a for a in sys.argv[1:]]
    refresh = "--refresh" in args
    args = [a for a in args if a != "--refresh"]
    url = args[0] if args else DEFAULT_URL

    ensure_tarball(url, refresh)
    lemmas = extract_lemmas()

    with open(SRC_LIST) as f:
        src = [w.strip() for w in f if w.strip()]
    kept = [w for w in src if w.lower() in lemmas]
    dropped = [w for w in src if w.lower() not in lemmas]

    new_content = "\n".join(kept) + "\n"
    old_content = None
    if os.path.exists(OUT_LIST):
        with open(OUT_LIST) as f:
            old_content = f.read()

    log(f"input {len(src)} -> kept {len(kept)} (dropped {len(dropped)})")
    log(f"sample dropped: {', '.join(dropped[:15])}")

    if new_content == old_content:
        log(f"{os.path.relpath(OUT_LIST, HERE)} unchanged")
        return
    with open(OUT_LIST, "w") as f:
        f.write(new_content)
    log(f"wrote {os.path.relpath(OUT_LIST, HERE)}")


if __name__ == "__main__":
    main()
