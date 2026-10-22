import base64
import argparse
import json
import socket
from datetime import date, datetime
from pathlib import Path


HOST = "81.70.70.93"
PORT = 8081
HANDSHAKE = base64.b64decode(
    "/gAAAjbJAQgAEhR6aGluYW50b25nX2FwcG5DUGdLQRoRZXowOC5hdXRoLmNvbm5lY3Q4AELoAw8RB3ZlcnNpb24GBzguMjUuMTEMAm9zBgdhbmRyb2lkFwlvc1ZlcnNpb24GC1BHVC1BTjEwLDEyGAdhcHBOYW1lBg56aGluYW50b25nX2FwcBsGYXBwdWlkBhJ6aGluYW50b25nX2FuZHJvaWQMBGNoaWQGBTIwMDAwJAt3aWZpTWFjQWRkcgYWaG9ub3JfN2Q2N2ZkYTJlZmVhNjNlMqsBBXBrZXlhB6IBMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDhvzQCfYmEO6+y5wUv5Oh4poOTZHJdKMzpN84D2BgP7FyP1L3wai37VnMhoG9O1n2LnT1fBaTJ+kpoMwG+BMExey23ia1NDm54P32weWL+m7f7sD0WHBcZaRBXi/OyxQSglMJZEP9Exw02OuGdLSMZlw8CVGRP9WQW5PFFjgvK5QIDAQABFhBOZXRNYW5nZXJWZXJzaW9uBgMxLjAKCHN4anNpZ25zGQ4LZGV2aWNlX3R5cGUAACIIdGltZXpvbmUGF0FzaWEvU2hhbmdoYWksR01UKzA4OjAwDQphZ3JlZXByb3RvAAAgBXRva2VuBhhadlJLSHM2QU5HdGYyNDhqdmVnUTZ3PT0YEmZpcnN0X2luc3RhbGxfZGF0ZQDFz9QJSABQAFoWVC16aGluYW50b25nX2FwcG5DUGdLQQ=="
)
DETAIL_REQUEST = base64.b64decode(
    "/gAAAIXJAQjdARoaZXowOC56bnRyLmhxLnN0b2NrZGV0YWlsLnEyC0w9LTEmUz0tMTAwOABCTwYEAXMAAQwJd2l0aGJvYXJkAAAOC3dpdGhzcGVlZGhxAAAKB3dpdGh6ZHQAABMIc2VjdWNvZGUGCFpfU0swQU1WDQpkYXRhX2xldmVsAAFIAFAA"
)
KLINE_REQUEST = base64.b64decode(
    "/gAAAH7JAQidARoUZXowOC56bnRyLmhxLmtsaW5lLnEyC0w9LTEmUz0tMTAwOABCTgYTCHNlY3Vjb2RlBghaX1NLMEFNVgwGcGVyaW9kBgNkYXkKBGRhdGUAzs/UCQkEdGltZQD9lQsGA2V4dAACDwNudW0A2vv/////////AUgAUAA="
)


def receive_frame(sock: socket.socket) -> bytes:
    data = bytearray()
    while len(data) < 5:
        chunk = sock.recv(65536)
        if not chunk:
            raise ConnectionError("连接在帧头接收完成前关闭")
        data.extend(chunk)
    if data[0] != 0xFE:
        raise ValueError(f"响应帧头错误:{data[:8].hex()}")
    expected = 5 + int.from_bytes(data[1:5], "big")
    while len(data) < expected:
        chunk = sock.recv(65536)
        if not chunk:
            raise ConnectionError("连接在响应接收完成前关闭")
        data.extend(chunk)
    return bytes(data[:expected])


def read_varint(data: bytes, pos: int):
    value = 0
    shift = 0
    for _ in range(10):
        byte = data[pos]
        pos += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, pos
        shift += 7
    raise ValueError("varint过长")


def encode_varint(value: int) -> bytes:
    output = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        output.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(output)


def make_kline_request() -> bytes:
    frame = bytearray(KLINE_REQUEST)
    old_date = encode_varint(20260814)
    new_date = encode_varint(int(date.today().strftime("%Y%m%d")))
    old_time = encode_varint(183037)
    new_time = encode_varint(int(datetime.now().strftime("%H%M%S")))
    body = bytes(frame[5:]).replace(b"\x0a\x04date\x00" + old_date, b"\x0a\x04date\x00" + new_date, 1)
    body = body.replace(b"\x09\x04time\x00" + old_time, b"\x09\x04time\x00" + new_time, 1)
    return b"\xfe" + len(body).to_bytes(4, "big") + body


def decode_detail(frame: bytes):
    trade_date = None
    date_end = None
    for pos, byte in enumerate(frame[:-1]):
        if byte != 0x10:
            continue
        try:
            value, end = read_varint(frame, pos + 1)
        except (IndexError, ValueError):
            continue
        if 20200101 <= value <= 20351231:
            trade_date, date_end = value, end
            break
    if trade_date is None:
        raise ValueError("未找到交易日期字段")

    prices = None
    for pos in range(date_end, len(frame) - 16):
        try:
            if frame[pos] != 0x10:
                continue
            open_value, p = read_varint(frame, pos + 1)
            if frame[p] != 0x18:
                continue
            high, p = read_varint(frame, p + 1)
            if frame[p] != 0x20:
                continue
            low, p = read_varint(frame, p + 1)
            if frame[p] != 0x28:
                continue
            close, p = read_varint(frame, p + 1)
            if all(100_000 <= value <= 10_000_000 for value in (open_value, high, low, close)):
                prices = (open_value, high, low, close, p)
                break
        except (IndexError, ValueError):
            continue
    if prices is None:
        raise ValueError("未找到0AMV价格字段")

    open_value, high, low, close, pos = prices
    previous_close = None
    while pos < len(frame):
        try:
            tag, value_pos = read_varint(frame, pos)
            field = tag >> 3
            wire = tag & 7
            if wire == 0:
                value, pos = read_varint(frame, value_pos)
                if field == 13 and 100_000 <= value <= 10_000_000:
                    previous_close = value
                    break
            elif wire == 2:
                length, start = read_varint(frame, value_pos)
                pos = start + length
            elif wire == 1:
                pos = value_pos + 8
            elif wire == 5:
                pos = value_pos + 4
            else:
                pos += 1
        except (IndexError, ValueError):
            pos += 1
    if previous_close is None:
        raise ValueError("未找到昨收字段")

    scale = 10
    change_percent = (close - previous_close) / previous_close * 100
    return {
        "date": datetime.strptime(str(trade_date), "%Y%m%d").strftime("%Y-%m-%d"),
        "close": close / scale,
        "change_percent": round(change_percent, 2),
        "previous_close": previous_close / scale,
        "open": open_value / scale,
        "high": high / scale,
        "low": low / scale,
        "source": f"指南针行情直连协议({HOST}:{PORT})",
    }


def decode_kline(frame: bytes, target_date: str):
    target = int(target_date.replace("-", ""))
    records = []
    marker = b"\xa5\x26\x08"
    pos = 0
    while True:
        pos = frame.find(marker, pos)
        if pos < 0:
            break
        try:
            trade_date, p = read_varint(frame, pos + len(marker))
            if frame[p] != 0x10:
                pos += 1
                continue
            open_value, p = read_varint(frame, p + 1)
            if frame[p] != 0x18:
                pos += 1
                continue
            close, p = read_varint(frame, p + 1)
            if frame[p] != 0x20:
                pos += 1
                continue
            high, p = read_varint(frame, p + 1)
            if frame[p] != 0x28:
                pos += 1
                continue
            low, _ = read_varint(frame, p + 1)
            if 20200101 <= trade_date <= 20351231:
                records.append({"date": trade_date, "open": open_value, "close": close, "high": high, "low": low})
        except (IndexError, ValueError):
            pass
        pos += 1
    for index, record in enumerate(records):
        if record["date"] != target:
            continue
        if index + 1 >= len(records):
            raise ValueError("找到目标日期，但缺少前一交易日数据")
        previous_close = records[index + 1]["close"]
        scale = 10
        return {
            "date": datetime.strptime(str(target), "%Y%m%d").strftime("%Y-%m-%d"),
            "close": record["close"] / scale,
            "change_percent": round((record["close"] - previous_close) / previous_close * 100, 2),
            "previous_close": previous_close / scale,
            "open": record["open"] / scale,
            "high": record["high"] / scale,
            "low": record["low"] / scale,
            "source": f"指南针日K直连协议({HOST}:{PORT})",
        }
    raise ValueError(f"日K响应中没有{target_date}的数据")


def decode_kline_range(frame: bytes, start_date: str, end_date: str):
    """Decode all daily K-line records in the requested inclusive date range."""
    start = int(start_date.replace("-", ""))
    end = int(end_date.replace("-", ""))
    records = []
    marker = b"\xa5\x26\x08"
    pos = 0
    while True:
        pos = frame.find(marker, pos)
        if pos < 0:
            break
        try:
            trade_date, p = read_varint(frame, pos + len(marker))
            if frame[p] != 0x10:
                pos += 1
                continue
            open_value, p = read_varint(frame, p + 1)
            if frame[p] != 0x18:
                pos += 1
                continue
            close, p = read_varint(frame, p + 1)
            if frame[p] != 0x20:
                pos += 1
                continue
            high, p = read_varint(frame, p + 1)
            if frame[p] != 0x28:
                pos += 1
                continue
            low, _ = read_varint(frame, p + 1)
            if 20200101 <= trade_date <= 20351231:
                records.append({"date": trade_date, "open": open_value, "close": close, "high": high, "low": low})
        except (IndexError, ValueError):
            pass
        pos += 1

    result = []
    for index, record in enumerate(records):
        if not start <= record["date"] <= end or index + 1 >= len(records):
            continue
        previous_close = records[index + 1]["close"]
        result.append({
            "date": datetime.strptime(str(record["date"]), "%Y%m%d").strftime("%Y-%m-%d"),
            "close": record["close"] / 10,
            "change_percent": round((record["close"] - previous_close) / previous_close * 100, 2),
        })
    return sorted(result, key=lambda item: item["date"])


def fetch(request: bytes):
    with socket.create_connection((HOST, PORT), timeout=8) as sock:
        sock.settimeout(8)
        sock.sendall(HANDSHAKE)
        receive_frame(sock)
        sock.sendall(request)
        return receive_frame(sock)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", help="读取历史交易日，例如2026-08-13")
    parser.add_argument("--start", help="导出起始日期，例如2026-04-07")
    parser.add_argument("--end", help="导出结束日期，例如2026-08-14")
    parser.add_argument("--output", help="TXT输出文件路径")
    args = parser.parse_args()
    range_mode = bool(args.start or args.end or args.output)
    if range_mode and not (args.start and args.end and args.output):
        parser.error("--start、--end、--output需要同时提供")
    response = fetch(make_kline_request() if (args.date or range_mode) else DETAIL_REQUEST)
    if range_mode:
        rows = decode_kline_range(response, args.start, args.end)
        output_path = Path(args.output)
        lines = ["日期\t收盘价\t涨跌幅"]
        lines.extend(f"{row['date']}\t{row['close']:.1f}\t{row['change_percent']:.2f}%" for row in rows)
        output_path.write_text("\n".join(lines) + "\n", encoding="utf-8-sig")
        print(json.dumps({"count": len(rows), "output": str(output_path.resolve()), "first": rows[0] if rows else None, "last": rows[-1] if rows else None}, ensure_ascii=False, indent=2))
    else:
        result = decode_kline(response, args.date) if args.date else decode_detail(response)
        print(json.dumps(result, ensure_ascii=False, indent=2))
