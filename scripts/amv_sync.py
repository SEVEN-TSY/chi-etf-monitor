"""将指南针0AMV历史表或直连日K导入本地SQLite，仅依赖Python标准库。"""
import argparse
from contextlib import closing
from datetime import date, datetime, timedelta, timezone
import importlib.util
import json
import math
from pathlib import Path
import posixpath
import sqlite3
import xml.etree.ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
FETCH_SCRIPT = Path(__file__).resolve().with_name("fetch_0amv_direct.py")
CST = timezone(timedelta(hours=8))
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def read_workbook(path):
    """只读正式工作表；使用C列缓存的涨跌幅，不读取汇总或触发规则。"""
    with ZipFile(path) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        sheet = next(s for s in workbook.findall("m:sheets/m:sheet", NS) if s.get("name") == "0AMV日线")
        rel_id = sheet.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        target = next(r.get("Target") for r in rels if r.get("Id") == rel_id)
        sheet_path = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = ["".join(n.itertext()) for n in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("m:si", NS)]
        date_system = workbook.find("m:workbookPr", NS)
        epoch = datetime(1904, 1, 1) if date_system is not None and date_system.get("date1904") in ("1", "true") else datetime(1899, 12, 30)
        rows, in_data = [], False
        for row in ET.fromstring(archive.read(sheet_path)).findall("m:sheetData/m:row", NS):
            cells = {}
            for cell in row:
                col = "".join(c for c in cell.get("r", "") if c.isalpha())
                value = cell.find("m:v", NS)
                inline = cell.find("m:is", NS)
                text = value.text if value is not None else "".join(inline.itertext()) if inline is not None else None
                cells[col] = strings[int(text)] if cell.get("t") == "s" and text is not None else text
            if cells.get("A") == "日期" and cells.get("B") == "0AMV收盘值" and cells.get("C") == "当日涨跌幅":
                in_data = True
                continue
            if not in_data:
                continue
            raw_day = cells.get("A")
            if not raw_day or raw_day.startswith("触发规则"):
                continue
            try:
                day = date.fromisoformat(raw_day[:10]) if "-" in raw_day else (epoch + timedelta(days=float(raw_day))).date()
                close, rate = float(cells["B"]), float(cells["C"]) * 100
            except (ValueError, TypeError, KeyError) as exc:
                raise ValueError(f"第{row.get('r')}行缺少有效日期、收盘值或涨跌幅缓存") from exc
            rows.append({"date": day.isoformat(), "close": close, "change_percent": rate})
    if not rows:
        raise ValueError("0AMV日线表没有有效数据")
    validate(rows)
    return rows


def validate(rows):
    seen = set()
    for row in rows:
        day = date.fromisoformat(row["date"])
        if day.isoformat() in seen:
            raise ValueError(f"0AMV日期重复：{day}")
        seen.add(day.isoformat())
        if not math.isfinite(row["close"]) or row["close"] <= 0 or not math.isfinite(row["change_percent"]) or row["change_percent"] <= -100:
            raise ValueError(f"0AMV数值无效：{day}")


def save_rows(database, rows, source, replace=False):
    validate(rows)
    database = Path(database)
    database.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(database, timeout=30)) as db, db:
        db.execute("""CREATE TABLE IF NOT EXISTS amv_observations (
            day TEXT PRIMARY KEY, close REAL NOT NULL CHECK(close>0),
            change_percent REAL NOT NULL, source TEXT NOT NULL,
            fetched_at TEXT NOT NULL)""")
        if any(column[1] == "raw_path" for column in db.execute("PRAGMA table_info(amv_observations)")):
            db.execute("ALTER TABLE amv_observations DROP COLUMN raw_path")
        before = db.total_changes
        conflict = """DO UPDATE SET close=excluded.close, change_percent=excluded.change_percent,
            source=excluded.source, fetched_at=excluded.fetched_at
            WHERE amv_observations.close != excluded.close
               OR ABS(amv_observations.change_percent-excluded.change_percent)>0.005""" if replace else "DO NOTHING"
        stamp = datetime.now(CST).isoformat()
        db.executemany(f"""INSERT INTO amv_observations
            (day,close,change_percent,source,fetched_at) VALUES (?,?,?,?,?)
            ON CONFLICT(day) {conflict}""", [
            (r["date"], r["close"], r["change_percent"], source, stamp) for r in rows
        ])
        return db.total_changes - before


def sync_range(database, script, start, end, now=None):
    now = now or datetime.now(CST)
    latest_closed = now.date() if now.hour >= 15 else now.date() - timedelta(days=1)
    if start > end or end > latest_closed:
        raise ValueError("补采日期须为已收盘日期，且起始日期不晚于结束日期")
    # 建表由采集命令负责；页面查询仍使用只读连接。
    save_rows(database, [], "")
    with closing(sqlite3.connect(database, timeout=30)) as db:
        existing = {day for (day,) in db.execute("SELECT day FROM amv_observations WHERE day BETWEEN ? AND ?", (start.isoformat(), end.isoformat()))}
    if all((start + timedelta(days=i)).isoformat() in existing or (start + timedelta(days=i)).weekday() >= 5
           for i in range((end-start).days + 1)):
        return {"changed": 0, "fetched": False, "missing": []}
    spec = importlib.util.spec_from_file_location("compass_amv_fetch", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    response = module.fetch(module.make_kline_request())
    rows = module.decode_kline_range(response, start.isoformat(), end.isoformat())
    validate(rows)
    if any(not start.isoformat() <= r["date"] <= end.isoformat() for r in rows):
        raise ValueError("行情返回日期超出请求范围")
    changed = save_rows(database, rows, "指南针0AMV日K直连", replace=True)
    returned = existing | {r["date"] for r in rows}
    missing = [start.isoformat()] if start == end and start.isoformat() not in returned else []
    return {"changed": changed, "fetched": True, "missing": missing}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=ROOT / "data" / "etf.sqlite3")
    parser.add_argument("--import-xlsx", type=Path, help="只追加历史表中尚未入库的日期，不修改Excel")
    parser.add_argument("--fetch-script", type=Path, default=FETCH_SCRIPT)
    dates = parser.add_mutually_exclusive_group()
    dates.add_argument("--date", type=date.fromisoformat, help="缺失才联网补采指定日期")
    dates.add_argument("--start", type=date.fromisoformat, help="补采起始日期，需同时提供--end")
    parser.add_argument("--end", type=date.fromisoformat)
    args = parser.parse_args()
    if bool(args.start) != bool(args.end):
        parser.error("--start和--end需要同时提供")
    if not args.import_xlsx and not args.date and not args.start:
        parser.error("请提供--import-xlsx、--date或--start/--end")
    result = {"database": str(args.database.resolve())}
    try:
        if args.import_xlsx:
            rows = read_workbook(args.import_xlsx)
            result["import"] = {"changed": save_rows(args.database, rows, "指南针0AMV历史表"),
                                "records": len(rows), "first": rows[0]["date"], "last": rows[-1]["date"]}
        if args.date or args.start:
            result["sync"] = sync_range(args.database, args.fetch_script, args.date or args.start, args.date or args.end)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
