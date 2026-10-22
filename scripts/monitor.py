"""从沪深交易所官方接口采集8只ETF份额。仅使用Python标准库。"""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import json
from pathlib import Path
import sqlite3
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
CST = timezone(timedelta(hours=8))
FUND_DEFINITIONS = json.loads(Path(__file__).resolve().with_name("funds.json").read_text(encoding="utf-8"))
FUNDS = {f["code"]: (f["name"], f["exchange"], f["group"]) for f in FUND_DEFINITIONS}
SSE_PAGE = "https://www.sse.com.cn/market/funddata/volumn/etfvolumn/"
SZSE_PAGE = "https://www.szse.cn/market/fund/volume/etf/index.html"


def request_json(base, params, referer):
    url = base + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0", "Referer": referer,
        "Accept": "application/json, text/javascript, */*; q=0.01",
    })
    with urllib.request.urlopen(req, timeout=25) as response:
        return json.load(response)


def shares(value):
    number = Decimal(str(value).replace(",", "")) * 10000
    if not number.is_finite() or number <= 0 or number != number.to_integral_value():
        raise ValueError(f"无效份额：{value}")
    return int(number)


def collect_sh(day):
    result = []
    page = 1
    while True:
        payload = request_json("https://query.sse.com.cn/commonQuery.do", {
            "sqlId": "COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L",
            "isPagination": "true", "pageHelp.pageSize": 2000,
            "pageHelp.pageNo": page, "STAT_DATE": day,
        }, SSE_PAGE)
        if payload.get("actionErrors") or payload.get("fieldErrors"):
            raise ValueError(f"上交所查询失败：{payload.get('actionErrors')}")
        rows = payload.get("result")
        if not isinstance(rows, list):
            raise ValueError("上交所未返回有效结果数组")
        for row in rows:
            code = row["SEC_CODE"]
            if code in FUNDS and FUNDS[code][1] == "SH":
                if row["STAT_DATE"] != day:
                    raise ValueError(f"上交所日期不符：请求{day}，返回{row['STAT_DATE']}")
                result.append((day, code, shares(row["TOT_VOL"]), "清算后"))
        if page >= int(payload.get("pageHelp", {}).get("pageCount") or 1):
            break
        page += 1
    return result


def collect_sz(code, start, end, now):
    result = []
    page = 1
    while True:
        payload = request_json("https://www.szse.cn/api/report/ShowReport/data", {
            "SHOWTYPE": "JSON", "CATALOGID": "scsj_fund_jjgm", "jjlb": "ETF",
            "txtDm": code, "txtStart": start, "txtEnd": end, "PAGENO": page,
        }, SZSE_PAGE)
        report = payload[0]
        if report.get("error"):
            raise ValueError(report["error"])
        # 官方表头为基金规模(万份)，表示份额数量，并非金额。
        if "万份" not in report["metadata"]["cols"]["current_size"]:
            raise ValueError("深交所份额单位发生变化")
        for row in report["data"]:
            day = row["size_date"]
            if row["fund_code"] != code or not start <= day <= end:
                raise ValueError("深交所返回的代码或日期不符合查询条件")
            # T日晚间数据仅供参考，以T+1日早间更新的T日规模为准。
            status = "次日早间口径" if day < now.date().isoformat() and now.hour >= 9 else "待早间复核"
            if day < (now.date() - timedelta(days=1)).isoformat():
                status = "次日早间口径"
            result.append((day, code, shares(row["current_size"]), status))
        if page >= int(report["metadata"].get("pagecount") or 1):
            break
        page += 1
    return result


def db_open():
    (ROOT / "data").mkdir(exist_ok=True)
    db = sqlite3.connect(ROOT / "data" / "etf.sqlite3", timeout=30)
    db.execute("""CREATE TABLE IF NOT EXISTS observations (
        day TEXT, code TEXT, shares INTEGER, status TEXT,
        fetched_at TEXT, PRIMARY KEY(day, code))""")
    if any(column[1] == "raw_path" for column in db.execute("PRAGMA table_info(observations)")):
        with db:
            db.execute("ALTER TABLE observations DROP COLUMN raw_path")
    db.execute("""CREATE TABLE IF NOT EXISTS requests (
        day TEXT PRIMARY KEY, checked_at TEXT)""")
    db.execute("""CREATE TABLE IF NOT EXISTS revisions (
        day TEXT, code TEXT, old_shares INTEGER, new_shares INTEGER, changed_at TEXT)""")
    return db


def fmt(value, signed=False):
    return f"{Decimal(value) / Decimal(100000000):{'+' if signed else ''},.4f}"


def make_report(db, now, errors):
    rows = db.execute("SELECT day,code,shares,status FROM observations ORDER BY day").fetchall()
    values = {(d, c): (s, status) for d, c, s, status in rows}
    days = sorted({d for d, c, s, status in rows})
    complete = [d for d in days if all((d, c) in values and values[d, c][1] != "待早间复核" for c in FUNDS)]
    day = days[-1] if days else None
    lines = ["# 八只ETF份额监控", "", f"采集时间：{now:%Y-%m-%d %H:%M}（北京时间）", ""]
    if day is None:
        lines += ["尚未取得可用数据。"]
    else:
        lines += [f"最近完整数据日：{complete[-1] if complete else '暂无'}。下表日期：{day}。", "",
                  "单位：亿份；变化率以区间起点份额为分母。缺失或待复核数据不按零处理。", "",
                  "| ETF | 代码 | 总份额 | 单日变化 | 单日变化率 | 5交易日变化 | 20交易日变化 |",
                  "| --- | --- | ---: | ---: | ---: | ---: | ---: |"]
        idx = days.index(day)

        def change(code, n):
            if idx < n:
                return None
            window = days[idx - n:idx + 1]
            if any((d, code) not in values or values[d, code][1] == "待早间复核" for d in window):
                return None
            # 已知请求失败区间无法确认交易日连续性，禁止标成单日或N交易日。
            if db.execute("SELECT COUNT(*) FROM requests WHERE day>? AND day<=?",
                          (window[0], day)).fetchone()[0] < sum(
                    (date.fromisoformat(window[0]) + timedelta(days=i)).weekday() < 5
                    for i in range(1, (date.fromisoformat(day) - date.fromisoformat(window[0])).days + 1)):
                return None
            return values[day, code][0] - values[window[0], code][0]

        for code, (name, exchange, group) in FUNDS.items():
            current = values.get((day, code))
            delta = change(code, 1)
            pct = f"{Decimal(delta) / Decimal(current[0] - delta) * 100:+.2f}%" if delta is not None else "—"
            changes = [change(code, n) for n in (1, 5, 20)]
            cells = [fmt(x, True) if x is not None else "—" for x in changes]
            lines.append(f"| {name} | {code} | {fmt(current[0]) if current else '—'} | {cells[0]} | {pct} | {cells[1]} | {cells[2]} |")
        deltas = {c: change(c, 1) for c in FUNDS}
        positive = sum(x is not None and x > 0 for x in deltas.values())
        negative = sum(x is not None and x < 0 for x in deltas.values())
        missing = sum(x is None for x in deltas.values())
        lines += ["", f"当日可比较数据中，份额增加{positive}只、减少{negative}只；缺失或待复核{missing}只。"]
        hs = [c for c in FUNDS if FUNDS[c][2] == "沪深300"]
        if all(deltas[c] is not None for c in hs):
            lines.append(f"四只沪深300ETF中，{sum(deltas[c] > 0 for c in hs)}只增加、{sum(deltas[c] < 0 for c in hs)}只减少。")
        if day not in complete:
            lines += [f"{day}的数据尚未齐全或含深市待复核值，表中不填入其他日期的数据。"]
        unusual = []
        for code, delta in deltas.items():
            if delta is not None and abs(Decimal(delta) / Decimal(values[day, code][0] - delta)) >= Decimal('0.10'):
                unusual.append(code)
        if unusual:
            lines += [f"单日份额变化绝对值达到10%的观察项：{'、'.join(unusual)}。尚未核实折算等公告原因，暂不归因于资金进出。"]
    lines += ["", "份额变化反映净申购赎回。不同ETF的份额不能直接相加解释为资金金额；如需估算申赎金额，应逐日以份额差乘当日单位净值，并注明估算口径。",
              "国家队买方身份无法由总份额识别，二级市场买入也可能不增加总份额。国家队持仓变化需结合基金持有人披露或官方公告确认。",
              "20日等区间不足时显示—；折算、拆分或合并导致的异常跳变需依据公告调整，不直接解释为资金流入流出。", "",
              "## 数据状态", "", "| 代码 | 最新数据日 | 状态 |", "| --- | --- | --- |"]
    for code in FUNDS:
        own = [(d, st) for d, c, s, st in rows if c == code]
        lines.append(f"| {code} | {own[-1][0] if own else '—'} | {own[-1][1] if own else '缺失'} |")
    if errors:
        lines += ["", "本次采集失败项："] + [f"- {x}" for x in errors]
    lines += ["", f"数据来源：[上交所ETF规模]({SSE_PAGE})、[深交所基金规模]({SZSE_PAGE})。",
              "深交所明确：T日晚间更新的T日规模仅供参考，以T+1日早间更新的T日规模为准；9:10是本监控计划采集时间，具体官方更新时间未核实。"]
    report = "\n".join(lines) + "\n"
    (ROOT / "reports").mkdir(exist_ok=True)
    (ROOT / "reports" / "latest.md").write_text(report, encoding="utf-8")
    (ROOT / "reports" / f"{now:%Y%m%d-%H%M%S}.md").write_text(report, encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    range_args = parser.add_mutually_exclusive_group()
    range_args.add_argument("--days", type=int, help="回看自然日数（1至366）；默认采集当年数据")
    range_args.add_argument("--start", type=date.fromisoformat, help="起始日期YYYY-MM-DD；默认当年1月1日")
    parser.add_argument("--end", type=date.fromisoformat, help="结束日期YYYY-MM-DD；默认今天")
    parser.add_argument("--report", action="store_true", help="手动生成分析报告；定时采集不使用")
    args = parser.parse_args()
    if args.days is not None and not 1 <= args.days <= 366:
        parser.error("--days必须介于1和366")
    now = datetime.now(CST)
    today = now.date()
    end = args.end or today
    start = args.start or (end - timedelta(days=args.days - 1) if args.days else date(end.year, 1, 1))
    if start > end or end > today:
        parser.error("日期须满足：起始日期<=结束日期<=今天")
    db = db_open()
    cached = {d for (d,) in db.execute("SELECT day FROM requests")}
    jobs = []
    errors = []
    changed = 0
    revised = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        for i in range((end - start).days + 1):
            target = start + timedelta(days=i)
            if target.weekday() < 5 and (target.isoformat() not in cached or target >= today - timedelta(days=7)):
                jobs.append((f"SH {target}", pool.submit(collect_sh, target.isoformat()), target.isoformat()))
        for code in ("159919", "159915"):
            # 深交所日期范围不超过6个月，长区间拆为最多180个自然日。
            chunk_start = start
            while chunk_start <= end:
                chunk_end = min(end, chunk_start + timedelta(days=179))
                jobs.append((f"SZ {code} {chunk_start}至{chunk_end}", pool.submit(
                    collect_sz, code, chunk_start.isoformat(), chunk_end.isoformat(), now), None))
                chunk_start = chunk_end + timedelta(days=1)
        mapping = {future: (label, target) for label, future, target in jobs}
        for future in as_completed(mapping):
            label, target = mapping[future]
            try:
                records = future.result()
                with db:
                    for day, code, amount, status in records:
                        old = db.execute("SELECT shares,status FROM observations WHERE day=? AND code=?", (day, code)).fetchone()
                        if old and old[0] != amount:
                            db.execute("INSERT INTO revisions VALUES (?,?,?,?,?)", (day, code, old[0], amount, now.isoformat()))
                            revised += 1
                        if not old or old != (amount, status):
                            changed += 1
                        db.execute("""INSERT OR REPLACE INTO observations
                                   (day,code,shares,status,fetched_at) VALUES (?,?,?,?,?)""",
                                   (day, code, amount, status, now.isoformat()))
                    if target:
                        db.execute("INSERT OR REPLACE INTO requests VALUES (?,?)", (target, now.isoformat()))
            except Exception as exc:
                errors.append(f"{label}：{exc}")
    if args.report:
        make_report(db, now, errors)
    result = {"changed_records": changed, "revised_records": revised, "errors": errors,
              "database": str(ROOT / "data" / "etf.sqlite3"),
              "collected_at": now.isoformat(),
              "report": str(ROOT / "reports" / "latest.md") if args.report else None,
              "records": db.execute("SELECT COUNT(*) FROM observations").fetchone()[0],
              "requested_start": start.isoformat(), "requested_end": end.isoformat(),
              "data_start": db.execute("SELECT MIN(day) FROM observations").fetchone()[0],
              "data_end": db.execute("SELECT MAX(day) FROM observations").fetchone()[0]}
    (ROOT / "data" / "last_run.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    db.close()
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
