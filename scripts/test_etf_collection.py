from contextlib import closing, redirect_stdout
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from datetime import date

import monitor
from collect_etf import collection_args


class CollectionCommandTest(unittest.TestCase):
    def test_default_is_yesterday_including_year_boundary(self):
        self.assertEqual(collection_args([], date(2026, 10, 22)),
                         ["--start", "2026-10-21", "--end", "2026-10-21"])
        self.assertEqual(collection_args([], date(2026, 1, 1)),
                         ["--start", "2025-12-31", "--end", "2025-12-31"])

    def test_positional_days_and_all(self):
        self.assertEqual(collection_args(["7"]), ["--days", "7"])
        self.assertEqual(collection_args(["all"]), [])


class CollectionOnlyTest(unittest.TestCase):
    def test_request_parses_response_without_creating_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with patch.object(monitor, "ROOT", root), patch.object(
                    monitor.urllib.request, "urlopen", return_value=io.BytesIO(b'{"result": []}')):
                self.assertEqual(monitor.request_json("https://example.com", {}, "https://example.com"),
                                 {"result": []})
            self.assertEqual(list(root.iterdir()), [])

    def test_exchange_collectors_return_database_fields(self):
        with patch.object(monitor, "request_json", return_value={"result": [
                {"SEC_CODE": "510300", "STAT_DATE": "2026-10-20", "TOT_VOL": "10,000"}]}):
            self.assertEqual(monitor.collect_sh("2026-10-20"),
                             [("2026-10-20", "510300", 100000000, "清算后")])
        with patch.object(monitor, "request_json", return_value=[{
                "metadata": {"cols": {"current_size": "基金规模(万份)"}},
                "data": [{"fund_code": "159919", "size_date": "2026-10-20", "current_size": "20,000"}]}]):
            self.assertEqual(monitor.collect_sz("159919", "2026-10-20", "2026-10-20",
                                               monitor.datetime(2026, 10, 21, 9, tzinfo=monitor.CST)),
                             [("2026-10-20", "159919", 200000000, "次日早间口径")])

    def test_existing_database_drops_raw_path_and_preserves_data(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "data").mkdir()
            with closing(sqlite3.connect(root / "data" / "etf.sqlite3")) as db, db:
                db.execute("""CREATE TABLE observations (
                    day TEXT, code TEXT, shares INTEGER, status TEXT, raw_path TEXT,
                    fetched_at TEXT, PRIMARY KEY(day, code))""")
                db.execute("INSERT INTO observations VALUES (?,?,?,?,?,?)",
                           ("2026-10-20", "510300", 100000000, "清算后", "raw/test.json", "stamp"))
            with patch.object(monitor, "ROOT", root), closing(monitor.db_open()) as db:
                self.assertNotIn("raw_path", [column[1] for column in db.execute("PRAGMA table_info(observations)")])
                self.assertEqual(db.execute("SELECT * FROM observations").fetchall(),
                                 [("2026-10-20", "510300", 100000000, "清算后", "stamp")])

    def test_default_collection_commits_data_without_reports_or_frontend_build(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            output = io.StringIO()
            day = "2026-01-05"
            def fake_sh(target):
                return [(target, "510300", 100000000, "清算后")]
            def fake_sz(code, start, end, now):
                return [(start, code, 200000000, "次日早间口径")]
            with patch.object(monitor, "ROOT", root), patch.object(monitor, "collect_sh", fake_sh), \
                    patch.object(monitor, "collect_sz", fake_sz), \
                    patch.object(monitor, "make_report") as report, \
                    patch("sys.argv", ["monitor.py", "--start", day, "--end", day]), redirect_stdout(output):
                self.assertEqual(monitor.main(), 0)
                report.assert_not_called()
            result = json.loads((root / "data" / "last_run.json").read_text(encoding="utf-8"))
            self.assertEqual(result["records"], 3)
            self.assertEqual(result["errors"], [])
            self.assertIsNone(result["report"])
            self.assertNotIn("visualization", result)
            self.assertFalse((root / "reports").exists())
            self.assertFalse((root / "frontend").exists())
            self.assertFalse((root / "data" / "raw").exists())
            with closing(sqlite3.connect(root / "data" / "etf.sqlite3")) as db:
                self.assertEqual(db.execute("SELECT COUNT(*) FROM observations").fetchone()[0], 3)


if __name__ == "__main__":
    unittest.main()
