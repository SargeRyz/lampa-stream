#!/usr/bin/env python3
"""Build small public metadata shards; never store playback URLs or credentials."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import urllib.request

SOURCE = 'https://raw.githubusercontent.com/immisterio/Lampac/38f5ee8aa6a86d49f7a11899fa0329799d8bb5a7/Core/data/veoveo.json'
SOURCE_SHA256 = 'a1a49b86cc039d198f4e7448bcdad08dab69a7c56a4258433791fe48b43a50db'
BUCKETS = 128


def normalize(value):
    return re.sub('[^a-z0-9а-я]+', '', str(value or '').lower().replace('ё', 'е'))


def bucket(key):
    value = 5381
    for character in key:
        value = (value * 33 + ord(character)) & 0xffffffff
    return f'{value % BUCKETS:02x}'


def build(raw, destination):
    digest = hashlib.sha256(raw).hexdigest()
    if digest != SOURCE_SHA256:
        raise ValueError('Каталог отличается от проверенного снимка; индекс не изменён.')
    records = json.loads(gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw)
    shards = {f'{i:02x}': {} for i in range(BUCKETS)}
    count = 0
    for item in records:
        identity = item.get('id')
        if not isinstance(identity, int) or identity <= 0:
            continue
        title, original = str(item.get('title') or ''), str(item.get('originalTitle') or '')
        kp = str(item.get('kinopoiskId') or '')
        imdb = str(item.get('imdbId') or '').lower()
        year = int(item.get('year') or 0)
        keys = set()
        if kp.isdecimal() and int(kp) > 0:
            keys.add('k:' + kp)
        if re.fullmatch('tt[0-9]+', imdb):
            keys.add('i:' + imdb)
        for name in [title, original]:
            if normalize(name):
                keys.add('t:' + normalize(name))
        row = [identity, title, original, year, kp, imdb]
        for key in sorted(keys):
            shards[bucket(key)].setdefault(key, []).append(row)
        count += 1
    destination.mkdir(parents=True, exist_ok=True)
    total, hashes = 0, {}
    for part, values in shards.items():
        content = json.dumps({'v': 1, 'keys': values}, ensure_ascii=False, separators=(',', ':')).encode()
        (destination / (part + '.json')).write_bytes(content)
        hashes[part + '.json'] = hashlib.sha256(content).hexdigest()
        total += len(content)
    manifest = {'v': 1, 'records': count, 'shards': BUCKETS, 'source': SOURCE,
                'source_sha256': digest, 'snapshot': '2026-10-26', 'bytes': total, 'files': hashes}
    (destination / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f'VeoVeo: {count} записей, {BUCKETS} частей, {total:,} байт; {destination}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'data/veoveo/v1')
    args = parser.parse_args()
    if args.input:
        raw = args.input.read_bytes()
    else:
        with urllib.request.urlopen(SOURCE, timeout=45) as response:
            raw = response.read(12_000_001)
        if len(raw) > 12_000_000:
            raise SystemExit('Превышен размер каталога.')
    build(raw, args.output)
