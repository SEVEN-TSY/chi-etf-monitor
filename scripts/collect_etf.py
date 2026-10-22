"""手动采集8只ETF并写入项目内SQLite，无需启动Codex或页面服务。"""
import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path
import runpy
import sys


def collection_args(argv, today=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", nargs="?", metavar="all或天数",
                        help="all采集当年数据；数字采集最近N天；默认采集北京时间昨天")
    ranges = parser.add_mutually_exclusive_group()
    ranges.add_argument("--days", type=int, help="回看自然日数（1至366）")
    ranges.add_argument("--start", help="起始日期YYYY-MM-DD")
    parser.add_argument("--end", help="结束日期YYYY-MM-DD")
    parser.add_argument("--report", action="store_true", help="额外生成旧版Markdown报告")
    args = parser.parse_args(argv)
    if args.mode is not None and any(x is not None for x in (args.days, args.start, args.end)):
        parser.error("all或天数不能与--days、--start或--end同时使用")
    forwarded = []
    if args.mode is not None and args.mode != "all":
        try:
            days = int(args.mode)
        except ValueError:
            parser.error("请输入all或1至366之间的天数")
        if not 1 <= days <= 366:
            parser.error("天数必须介于1和366")
        forwarded = ["--days", str(days)]
    for name in ("days", "start", "end"):
        value = getattr(args, name)
        if value is not None:
            forwarded.extend([f"--{name}", str(value)])
    if not args.mode and not forwarded:
        today = today or datetime.now(timezone(timedelta(hours=8))).date()
        yesterday = (today - timedelta(days=1)).isoformat()
        forwarded = ["--start", yesterday, "--end", yesterday]
    if args.report:
        forwarded.append("--report")
    return forwarded


if __name__ == "__main__":
    # 复用采集实现，仅调整手动执行时的默认日期范围。
    monitor = Path(__file__).resolve().with_name("monitor.py")
    sys.argv = [str(monitor), *collection_args(sys.argv[1:])]
    runpy.run_path(str(monitor), run_name="__main__")
