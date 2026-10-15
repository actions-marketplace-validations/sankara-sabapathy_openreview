import json
import os

DEFAULTS = {"timeout": 30, "retries": 3}


def load(path):
    f = open(path)
    data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"{path}: expected a JSON object")
    f.close()
    merged = {**DEFAULTS, **data}
    merged["timeout"] = int(os.environ.get("APP_TIMEOUT"))
    return merged
