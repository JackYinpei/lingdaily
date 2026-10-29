#!/usr/bin/env python3
"""Private, bounded daily podcast trigger. Credentials stay in local .env."""
from contextlib import contextmanager
from pathlib import Path
import fcntl
import json
import os
import random
import signal
import socket
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def read_env(path):
    values = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.removeprefix('export ').strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ['"', "'"]:
            value = value[1:-1]
        values[key] = value
    return values


def emit(event, **fields):
    print(json.dumps({'time': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'event': event, **fields}), flush=True)


@contextmanager
def generation_lock(path):
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        os.fchmod(fd, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            yield False
            return
        yield True
    finally:
        os.close(fd)


@contextmanager
def request_deadline(seconds):
    """Interrupt the entire HTTP call, including trickling reads, on Linux's main thread."""
    def expired(_signum, _frame):
        raise TimeoutError('podcast request deadline exceeded')

    previous_handler = signal.getsignal(signal.SIGALRM)
    previous_timer = signal.setitimer(signal.ITIMER_REAL, 0)
    started = time.monotonic()
    try:
        signal.signal(signal.SIGALRM, expired)
        signal.setitimer(signal.ITIMER_REAL, seconds)
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        delay, interval = previous_timer
        if delay > 0:
            # Restore the caller's timer without adding our elapsed wall time.
            delay = max(0.000001, delay - (time.monotonic() - started))
        signal.setitimer(signal.ITIMER_REAL, delay, interval)


def request_generation(url, secret, timeout):
    req = Request(url, data=b'{}', method='POST', headers={
        'x-podcast-secret': secret,
        'Content-Type': 'application/json',
        'User-Agent': 'LingDaily-private-cron/3.8',
    })
    try:
        with urlopen(req, timeout=timeout) as response:
            status = response.status
            raw = response.read()
    except HTTPError as error:
        # Do not echo response bodies, request headers, or credentials to cron logs.
        return error.code, None
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        body = None
    return status, body


def run(env_path, lock_path, *, call=request_generation, sleep=time.sleep, clock=time.monotonic, logger=emit):
    values = read_env(env_path)
    secret = values.get('PODCAST_SECRET')
    if not secret:
        logger('configuration_error', reason='PODCAST_SECRET missing')
        return 2
    # Keep production calls on the loopback endpoint; never force a second episode.
    url = 'http://127.0.0.1:8000/api/podcast/generate'
    deadline = clock() + 10800
    with generation_lock(lock_path) as acquired:
        if not acquired:
            logger('skipped', reason='daily generator already locked')
            return 0
        for attempt in range(1, 4):
            remaining = deadline - clock()
            if remaining <= 0:
                logger('failed', reason='total cron deadline exceeded; checkpoints retained')
                return 1
            logger('attempt_started', attempt=attempt)
            try:
                with request_deadline(min(7200, remaining)):
                    status, body = call(url, secret, min(7200, remaining))
            except (URLError, TimeoutError, socket.timeout, ConnectionError, OSError):
                status, body = 0, None
            # A late success must not be reported as completed, even if the call
            # swallowed a timeout or returned as the overall budget expired.
            if clock() >= deadline:
                logger('failed', reason='total cron deadline exceeded; checkpoints retained')
                return 1
            if 200 <= status < 300 and isinstance(body, dict) and body.get('ok') is True:
                episode = body.get('episode') or {}
                logger('completed', attempt=attempt, skipped=bool(body.get('skipped')), episode=episode.get('id'), model=body.get('model'))
                return 0
            if status in [400, 401, 403, 404, 405, 422]:
                logger('failed', attempt=attempt, status=status, reason='non-retryable request')
                return 1
            logger('attempt_failed', attempt=attempt, status=status)
            if attempt < 3:
                delay = min(60 * (2 ** (attempt - 1)) + random.uniform(0, 10), max(0, deadline - clock()))
                if delay <= 0:
                    break
                logger('retry_wait', seconds=round(delay, 2))
                sleep(delay)
        logger('failed', reason='bounded attempts exhausted; checkpoints retained')
        return 1


def main():
    home = Path('/root/lingdaily')
    os.umask(0o077)
    try:
        return run(home / '.env', home / '.podcast-cron.lock')
    except Exception as error:
        emit('failed', reason=type(error).__name__)
        return 1


if __name__ == '__main__':
    sys.exit(main())
