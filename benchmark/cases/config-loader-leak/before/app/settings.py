import json

DEFAULTS = {"timeout": 30, "retries": 3}


def load(path):
    with open(path) as f:
        data = json.load(f)
    return {**DEFAULTS, **data}
