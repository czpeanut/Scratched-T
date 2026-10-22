"""Minimal Gemini image-generation client (Python stdlib only).

The API key is read from the GEMINI_API_KEY environment variable and is never
written anywhere - keep it out of the repository.

usage:
  GEMINI_API_KEY=... python3 tools/gemini_gen.py OUT.png "prompt" \
      [--model gemini-3-pro-image] [--ref ref.png ...] [--aspect 21:9] [--size 2K]

`--ref` attaches reference images; passing an existing character frame is
what keeps a character consistent across separately generated strips.
"""
import argparse
import base64
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

API = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'


def ssl_context():
    # Honour a custom CA bundle when one is configured (corporate/sandbox
    # proxies), otherwise use the system store.
    cafile = os.environ.get('SSL_CERT_FILE') or os.environ.get('REQUESTS_CA_BUNDLE')
    return ssl.create_default_context(cafile=cafile) if cafile else ssl.create_default_context()


def generate(prompt, model, refs=(), aspect=None, size=None, retries=3):
    key = os.environ.get('GEMINI_API_KEY')
    if not key:
        sys.exit('GEMINI_API_KEY is not set')
    parts = []
    for r in refs:
        with open(r, 'rb') as f:
            parts.append({'inline_data': {'mime_type': 'image/png', 'data': base64.b64encode(f.read()).decode()}})
    parts.append({'text': prompt})
    cfg = {'responseModalities': ['IMAGE']}
    img_cfg = {k: v for k, v in (('aspectRatio', aspect), ('imageSize', size)) if v}
    if img_cfg:
        cfg['imageConfig'] = img_cfg
    body = json.dumps({'contents': [{'parts': parts}], 'generationConfig': cfg}).encode()
    ctx = ssl_context()
    for attempt in range(retries):
        req = urllib.request.Request(API.format(model=model), data=body, headers={
            'Content-Type': 'application/json', 'x-goog-api-key': key})
        try:
            with urllib.request.urlopen(req, context=ctx, timeout=300) as resp:
                data = json.load(resp)
            break
        except urllib.error.HTTPError as e:
            print(f'HTTP {e.code}: {e.read().decode()[:600]}', file=sys.stderr)
            if e.code in (429, 500, 503) and attempt < retries - 1:
                time.sleep(5 * (attempt + 1))
                continue
            sys.exit(1)
    for cand in data.get('candidates', []):
        for p in cand.get('content', {}).get('parts', []):
            blob = p.get('inline_data') or p.get('inlineData')
            if blob:
                return base64.b64decode(blob['data'])
    sys.exit('no image in response: ' + json.dumps(data)[:800])


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('prompt')
    ap.add_argument('--model', default='gemini-3-pro-image')
    ap.add_argument('--ref', action='append', default=[])
    ap.add_argument('--aspect')
    ap.add_argument('--size')
    a = ap.parse_args()
    t = time.time()
    img = generate(a.prompt, a.model, a.ref, a.aspect, a.size)
    with open(a.out, 'wb') as f:
        f.write(img)
    print(f'wrote {a.out} ({len(img) // 1024} KB) in {time.time() - t:.1f}s')
