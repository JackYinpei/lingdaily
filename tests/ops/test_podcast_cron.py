import importlib.util
from pathlib import Path
import signal
import tempfile
import time
import unittest
from unittest.mock import patch
from urllib.error import URLError

MODULE = Path(__file__).resolve().parents[2] / 'scripts' / 'podcast-cron.py'
spec = importlib.util.spec_from_file_location('podcast_cron', MODULE)
cron = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cron)


class PodcastCronTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.env = self.root / '.env'
        self.env.write_text('PODCAST_SECRET="test-only-not-a-real-secret"\n')
        self.lock = self.root / '.lock'
        self.logs = []
        self.sleeps = []

    def tearDown(self):
        self.tmp.cleanup()

    def run_cron(self, call):
        return cron.run(self.env, self.lock, call=call, sleep=self.sleeps.append,
                        clock=lambda: 0, logger=lambda event, **kw: self.logs.append((event, kw)))

    def test_success_does_not_grep_the_word_error_in_generated_text(self):
        calls = []
        def call(url, secret, timeout):
            calls.append((url, timeout))
            return 200, {'ok': True, 'episode': {'id': 'test', 'summary': 'error is a vocabulary term'}}
        self.assertEqual(self.run_cron(call), 0)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1], 7200)
        self.assertNotIn('force=true', calls[0][0])
        self.assertNotIn('test-only-not-a-real-secret', str(self.logs))

    def test_transient_failure_resumes_same_endpoint(self):
        calls = []
        def call(url, secret, timeout):
            calls.append(url)
            return (503, None) if len(calls) == 1 else (200, {'ok': True})
        self.assertEqual(self.run_cron(call), 0)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0], calls[1])
        self.assertEqual(len(self.sleeps), 1)

    def test_auth_error_is_not_retried(self):
        calls = []
        self.assertEqual(self.run_cron(lambda *args: (calls.append(1) or 401, None)), 1)
        self.assertEqual(len(calls), 1)
        self.assertFalse(self.sleeps)

    def test_network_errors_have_a_bounded_budget(self):
        calls = []
        def call(*args):
            calls.append(1)
            raise URLError('offline unit test')
        self.assertEqual(self.run_cron(call), 1)
        self.assertEqual(len(calls), 3)
        self.assertEqual(len(self.sleeps), 2)

    def test_existing_lock_skips_without_api_calls(self):
        with cron.generation_lock(self.lock) as acquired:
            self.assertTrue(acquired)
            self.assertEqual(self.run_cron(lambda *args: self.fail('must not call API')), 0)
        self.assertEqual(self.lock.stat().st_mode & 0o777, 0o600)

    def test_missing_secret_does_not_call(self):
        self.env.write_text('OTHER_SETTING=yes\n')
        self.assertEqual(self.run_cron(lambda *args: self.fail('must not call API')), 2)

    def test_total_deadline_bounds_http_timeout(self):
        times = iter([0, 10000, 10001])
        timeouts = []
        result = cron.run(self.env, self.lock, call=lambda u, s, t: (timeouts.append(t) or 200, {'ok': True}),
                          sleep=self.sleeps.append, clock=lambda: next(times), logger=lambda *a, **kw: None)
        self.assertEqual(result, 0)
        self.assertEqual(timeouts, [800])

    def test_late_success_is_not_completed_and_retains_checkpoints(self):
        checkpoint = self.root / 'script.json'
        checkpoint.write_text('retained-checkpoint')
        times = iter([0, 10799, 10801])
        result = cron.run(self.env, self.lock, call=lambda *args: (200, {'ok': True}),
                          clock=lambda: next(times), logger=lambda event, **kw: self.logs.append((event, kw)))
        self.assertEqual(result, 1)
        self.assertNotIn('completed', [event for event, _ in self.logs])
        self.assertEqual(checkpoint.read_text(), 'retained-checkpoint')
        with cron.generation_lock(self.lock) as acquired:
            self.assertTrue(acquired)

    def test_wall_deadline_interrupts_trickling_read_and_cleans_up(self):
        closed = []
        checkpoint = self.root / 'saved-turn.pcm'
        checkpoint.write_bytes(b'retained-audio')
        class TrickleResponse:
            status = 200
            def __enter__(self):
                return self
            def __exit__(self, *args):
                closed.append(True)
            def read(self):
                # Every individual wait is below the socket timeout. A socket
                # timeout alone would allow this read to continue for seconds.
                for _ in range(300):
                    time.sleep(0.01)
                return b'{"ok":true}'

        started = time.monotonic()
        initial = True
        def clock():
            nonlocal initial
            if initial:
                initial = False
                return 0
            return 10799.85 + (time.monotonic() - started)

        handler = signal.getsignal(signal.SIGALRM)
        with patch.object(cron, 'urlopen', return_value=TrickleResponse()) as opening:
            result = cron.run(self.env, self.lock, clock=clock, sleep=self.sleeps.append,
                              logger=lambda event, **kw: self.logs.append((event, kw)))
        self.assertEqual(result, 1)
        self.assertLess(time.monotonic() - started, 1.5)
        self.assertEqual(opening.call_count, 1)
        self.assertEqual(closed, [True])
        self.assertFalse(self.sleeps)
        self.assertEqual(signal.getsignal(signal.SIGALRM), handler)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0, 0))
        self.assertNotIn('completed', [event for event, _ in self.logs])
        self.assertNotIn('test-only-not-a-real-secret', str(self.logs))
        self.assertEqual(checkpoint.read_bytes(), b'retained-audio')
        with cron.generation_lock(self.lock) as acquired:
            self.assertTrue(acquired)

    def test_request_deadline_restores_previous_handler_and_timer(self):
        old_handler = signal.getsignal(signal.SIGALRM)
        old_timer = signal.setitimer(signal.ITIMER_REAL, 0)
        def previous_handler(*args):
            self.fail('previous timer must not fire during this test')
        try:
            signal.signal(signal.SIGALRM, previous_handler)
            for outcome in ['success', 'timeout', 'error']:
                with self.subTest(outcome=outcome):
                    signal.setitimer(signal.ITIMER_REAL, 10, 2)
                    try:
                        with cron.request_deadline(0.04):
                            if outcome == 'timeout':
                                time.sleep(1)
                            elif outcome == 'error':
                                raise ValueError('offline failure')
                    except TimeoutError:
                        self.assertEqual(outcome, 'timeout')
                    except ValueError:
                        self.assertEqual(outcome, 'error')
                    else:
                        self.assertEqual(outcome, 'success')
                    self.assertIs(signal.getsignal(signal.SIGALRM), previous_handler)
                    remaining, interval = signal.getitimer(signal.ITIMER_REAL)
                    self.assertGreater(remaining, 8)
                    self.assertLessEqual(remaining, 10)
                    self.assertEqual(interval, 2)
                    if outcome == 'timeout':
                        self.assertLess(remaining, 9.98)
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, old_handler)
            signal.setitimer(signal.ITIMER_REAL, *old_timer)


if __name__ == '__main__':
    unittest.main()
