"""Public YouTube card metadata; never invokes transcript or model providers."""
import re
import threading
import time
from urllib.parse import parse_qs, urlsplit

import requests

_cache = {}
_lock = threading.Lock()


def youtube_url(value):
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in ('http', 'https') or parsed.username or parsed.password:
            return None
        if parsed.hostname == 'youtu.be':
            video_id = parsed.path.strip('/')
        elif parsed.hostname in ('youtube.com', 'www.youtube.com', 'm.youtube.com'):
            if parsed.path == '/watch':
                video_id = parse_qs(parsed.query).get('v', [''])[0]
            else:
                match = re.fullmatch(r'/(?:shorts|live|embed)/([\w-]{11})/?', parsed.path)
                video_id = match.group(1) if match else ''
        else:
            return None
        if not re.fullmatch(r'[A-Za-z0-9_-]{11}', video_id):
            return None
        return f'https://www.youtube.com/watch?v={video_id}'
    except (TypeError, ValueError):
        return None


def get_metadata(url):
    canonical = youtube_url(url)
    if not canonical:
        raise ValueError('Invalid YouTube URL')
    now = time.monotonic()
    with _lock:
        cached = _cache.get(canonical)
        if cached and cached[0] > now:
            return dict(cached[1])
    result = {'url': canonical, 'title': 'YouTube video', 'author': '', 'thumbnail_url': None}
    success = False
    try:
        response = requests.get('https://www.youtube.com/oembed',
                                params={'url': canonical, 'format': 'json'},
                                timeout=5, allow_redirects=False)
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, dict):
                for field, key in [('title', 'title'), ('author', 'author_name')]:
                    if isinstance(data.get(key), str) and data[key].strip():
                        result[field] = data[key].strip()[:300]
                thumbnail = data.get('thumbnail_url', '')
                if isinstance(thumbnail, str):
                    parsed = urlsplit(thumbnail)
                    if parsed.scheme == 'https' and parsed.hostname in ('i.ytimg.com', 'img.youtube.com') and not parsed.username and not parsed.password:
                        result['thumbnail_url'] = thumbnail
                success = True
    except (requests.RequestException, ValueError):
        pass
    with _lock:
        if len(_cache) >= 128:
            del _cache[next(iter(_cache))]
        _cache[canonical] = (now + (3600 if success else 30), result)
    return dict(result)
