def word_count(s: str) -> int:
    return len(s.split())


def truncate_words(s: str, limit: int, suffix: str = "...") -> str:
    """Keep at most `limit` words of `s`, appending `suffix` when anything was cut."""
    if limit < 0:
        raise ValueError("limit must be >= 0")
    words = s.split()
    if len(words) <= limit:
        return " ".join(words)
    return " ".join(words[:limit]) + suffix
