from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from datetime import date, datetime
from unittest.mock import patch
from zipfile import ZipFile

import amv_sync


class AmvSyncTests(unittest.TestCase):
    def test_workbook_percentage_and_duplicate_import(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "history.xlsx"
            with ZipFile(path, "w") as z:
                z.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="0AMV日线" r:id="s1"/></sheets></workbook>')
                z.writestr("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="s1" Target="worksheets/sheet1.xml"/></Relationships>')
                z.writestr("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="8"><c r="A8" t="inlineStr"><is><t>日期</t></is></c><c r="B8" t="inlineStr"><is><t>0AMV收盘值</t></is></c><c r="C8" t="inlineStr"><is><t>当日涨跌幅</t></is></c></row><row r="9"><c r="A9"><v>46315</v></c><c r="B9"><v>141348.3</v></c><c r="C9"><v>0.0035691565799711353</v></c></row></sheetData></worksheet>')
            rows = amv_sync.read_workbook(path)
            self.assertEqual(rows[0]["date"], "2026-10-20")
            self.assertAlmostEqual(rows[0]["change_percent"], 0.35691565799711353)
            database = Path(folder) / "data.sqlite3"
            self.assertEqual(amv_sync.save_rows(database, rows, "test"), 1)
            self.assertEqual(amv_sync.save_rows(database, rows, "test"), 0)

    def test_existing_database_drops_raw_path_and_supports_revisions(self):
        with tempfile.TemporaryDirectory() as folder:
            database = Path(folder) / "data.sqlite3"
            with closing(sqlite3.connect(database)) as db, db:
                db.execute("""CREATE TABLE amv_observations (
                    day TEXT PRIMARY KEY, close REAL NOT NULL CHECK(close>0),
                    change_percent REAL NOT NULL, source TEXT NOT NULL,
                    raw_path TEXT NOT NULL, fetched_at TEXT NOT NULL)""")
                db.execute("INSERT INTO amv_observations VALUES (?,?,?,?,?,?)",
                           ("2026-10-20", 141348.3, 0.36, "test", "raw/test.bin", "stamp"))
            self.assertEqual(amv_sync.save_rows(database, [], "test"), 0)
            with closing(sqlite3.connect(database)) as db:
                self.assertNotIn("raw_path", [column[1] for column in db.execute("PRAGMA table_info(amv_observations)")])
                self.assertEqual(db.execute("SELECT * FROM amv_observations").fetchall(),
                                 [("2026-10-20", 141348.3, 0.36, "test", "stamp")])
            self.assertEqual(amv_sync.save_rows(database, [
                {"date": "2026-10-20", "close": 141350.0, "change_percent": 0.37}], "updated", replace=True), 1)
            with closing(sqlite3.connect(database)) as db:
                self.assertEqual(db.execute("SELECT close,change_percent,source FROM amv_observations").fetchone(),
                                 (141350.0, 0.37, "updated"))

    def test_fill_range_once_and_cached_date_never_fetches(self):
        with tempfile.TemporaryDirectory() as folder:
            database, script = Path(folder) / "data.sqlite3", Path(folder) / "fetch.py"
            rows = [{"date": "2026-10-19", "close": 140845.6, "change_percent": -0.85},
                    {"date": "2026-10-20", "close": 141348.3, "change_percent": 0.36}]
            script.write_text('def make_kline_request(): return b"request"\ndef fetch(request): return b"response"\ndef decode_kline_range(response, start, end): return ' + repr(rows), encoding="utf-8")
            result = amv_sync.sync_range(database, script, date(2026, 10, 19), date(2026, 10, 20))
            self.assertEqual(result["changed"], 2)
            self.assertFalse((Path(folder) / "raw").exists())
            with patch.object(amv_sync.importlib.util, "spec_from_file_location", side_effect=AssertionError("缓存命中不应联网")):
                cached = amv_sync.sync_range(database, script, date(2026, 10, 20), date(2026, 10, 20))
            self.assertFalse(cached["fetched"])
            with closing(sqlite3.connect(database)) as db:
                self.assertEqual(db.execute("SELECT change_percent FROM amv_observations WHERE day='2026-10-20'").fetchone()[0], 0.36)

    def test_failed_fetch_retains_history_and_intraday_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            database, script = Path(folder) / "data.sqlite3", Path(folder) / "fetch.py"
            amv_sync.save_rows(database, [{"date": "2026-10-19", "close": 140845.6, "change_percent": -0.85}], "test")
            script.write_text('def make_kline_request(): return b"request"\ndef fetch(request): raise TimeoutError("行情超时")', encoding="utf-8")
            with self.assertRaises(TimeoutError):
                amv_sync.sync_range(database, script, date(2026, 10, 20), date(2026, 10, 20))
            with closing(sqlite3.connect(database)) as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM amv_observations").fetchone()[0], 1)
            with self.assertRaises(ValueError):
                amv_sync.sync_range(database, script, date(2026, 10, 21), date(2026, 10, 21), datetime(2026, 10, 21, 14, tzinfo=amv_sync.CST))


if __name__ == "__main__":
    unittest.main()
