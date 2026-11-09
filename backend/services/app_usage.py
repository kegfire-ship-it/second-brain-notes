"""No-op stand-in: this edition doesn't keep AI usage statistics."""
from contextlib import contextmanager


@contextmanager
def usage_scope(user_id):
    yield


def user_scoped(fn):
    return fn


def record(*args, **kwargs):
    pass


def call(provider, operation, model, fn):
    return fn()
