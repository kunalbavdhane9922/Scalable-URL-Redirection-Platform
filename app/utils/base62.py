CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
BASE = len(CHARSET)


def encode(num: int) -> str:
    if num == 0:
        return CHARSET[0]

    result = []
    while num > 0:
        num, remainder = divmod(num, BASE)
        result.append(CHARSET[remainder])
    return "".join(reversed(result))


def decode(string: str) -> int:
    num = 0
    for char in string:
        num = num * BASE + CHARSET.index(char)
    return num
