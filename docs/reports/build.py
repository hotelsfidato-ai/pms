"""Builds docs/reports/fidato-reports.html from the day files beside it.

Each day of the Fidato PMS Reports artifact is one file, report-YYYY-MM-DD.json,
written the morning after. This script puts every day into the page, newest
first, fills the four summary tiles from the day's own lists (so a number can
never disagree with what is listed), and stamps the time it was built.

    python docs/reports/build.py
"""
import glob
import json
import os
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(HERE, "fidato-reports.html")
TEMPLATE = os.path.join(HERE, "template.html")


def tiles(day):
    items = [i for g in day.get("completed", []) for i in g["items"]]
    checked = sum(1 for i in items if i["check"] in ("verified", "live"))
    live = sum(1 for i in items if i["check"] == "live")
    waiting = len([d for d in day.get("decisions", []) if not d["from"].startswith("You to run")])
    problems = len(day.get("problems", []))
    return [
        {"value": checked, "label": "completed and checked", "tone": "good"},
        {"value": live, "label": "of those already live", "tone": ""},
        {"value": waiting, "label": "decisions waiting on you", "tone": "wait" if waiting else ""},
        {"value": problems, "label": "problems found", "tone": "bad" if problems else ""},
    ]


def main():
    days = []
    for path in glob.glob(os.path.join(HERE, "report-*.json")):
        with open(path, encoding="utf-8") as f:
            day = json.load(f)
        day["tiles"] = tiles(day)
        days.append(day)
    days.sort(key=lambda d: d["date"], reverse=True)
    stamp = datetime.now().strftime("%d %b %Y, %H:%M")
    data = json.dumps({"updated": stamp, "days": days}, ensure_ascii=False, indent=1)
    data = data.replace("</", "<\\/")   # never close the script tag from inside the data
    with open(TEMPLATE, encoding="utf-8") as f:
        html = f.read()
    if "__DATA__" not in html:
        sys.exit("template.html has no __DATA__ placeholder")
    with open(PAGE, "w", encoding="utf-8", newline="\n") as f:
        f.write(html.replace("__DATA__", data))
    print(f"built {PAGE}: {len(days)} day(s), updated {stamp}")


if __name__ == "__main__":
    main()
