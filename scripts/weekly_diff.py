#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import os
from pathlib import Path

from .rakuten_client import RakutenAPIClient, NonRetryableAPIError


def parse_args():
    p = argparse.ArgumentParser(description="週次差分: 対象選定+詳細更新（cap）")
    p.add_argument("--lookback-days", type=int, default=7)
    p.add_argument("--stale-days", type=int, default=14)
    p.add_argument("--max", type=int, default=300)
    p.add_argument("--interval", type=float, default=3.1)
    p.add_argument("--output-dir", default="data_master")
    return p.parse_args()


def load_recent_ranking(lookback_days: int) -> dict:
    now = dt.datetime.utcnow()
    cutoff = f"ranking_{(now - dt.timedelta(days=lookback_days)).strftime('%Y%m%d')}"
    files = [p for p in sorted(glob.glob("ranking_*.jsonl")) if p >= f"{cutoff}.jsonl"]
    last_seen = {}
    for fn in files[-lookback_days:]:
        with open(fn, encoding="utf-8") as f:
            for line in f:
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                code = r.get("itemCode")
                if code:
                    last_seen[code] = r
    return last_seen


def load_details(path: Path) -> dict:
    d = {}
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                it = json.loads(line)
                d[it["itemCode"]] = it
            except Exception:
                continue
    return d


def is_stale(it: dict, stale_days: int) -> bool:
    ts = it.get("fetched_at")
    if not ts:
        return True
    try:
        ts = ts.replace("Z", "+00:00")
        from datetime import datetime, timezone
        dt_obj = datetime.fromisoformat(ts)
        age = datetime.utcnow().replace(tzinfo=timezone.utc) - dt_obj.astimezone(timezone.utc)
        return age.days > stale_days
    except Exception:
        return True


def select_targets(lookback_days: int, stale_days: int, limit: int) -> list[str]:
    last_seen = load_recent_ranking(lookback_days)
    details = load_details(Path("data_master/item_details.jsonl"))
    targets = []
    for code, r in last_seen.items():
        d = details.get(code)
        if not d:
            targets.append(code)
            continue
        price_changed = str(r.get("itemPrice")) != str(d.get("itemPrice"))
        pr_changed = str(r.get("pointRate")) != str(d.get("pointRate")) or \
                     str(r.get("pointRateStartTime")) != str(d.get("pointRateStartTime")) or \
                     str(r.get("pointRateEndTime")) != str(d.get("pointRateEndTime"))
        rc_now = int(r.get("reviewCount", 0))
        rc_old = int(d.get("reviewCount", 0))
        rc_up = (rc_old > 0 and (rc_now - rc_old) / rc_old >= 0.05) or (rc_now - rc_old) >= 1000
        if price_changed or pr_changed or rc_up or is_stale(d, stale_days):
            targets.append(code)
    return targets[: max(0, int(limit))]


def main():
    args = parse_args()
    app_id = os.environ.get("RAKUTEN_APP_ID")
    aff_id = os.environ.get("RAKUTEN_AFFILIATE_ID")
    if not app_id:
        raise SystemExit("RAKUTEN_APP_ID is required via environment variables")

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    details_path = out_dir / "item_details.jsonl"
    shops_path = out_dir / "shops.json"

    targets = select_targets(args.lookback_days, args.stale_days, args.max)
    if not targets:
        print("No targets. Exit.")
        return

    details = load_details(details_path)
    shops_dict = {}
    if shops_path.exists():
        try:
            for s in json.loads(shops_path.read_text(encoding="utf-8")):
                shops_dict[s.get("shopCode")] = s
        except Exception:
            pass

    client = RakutenAPIClient(app_id, aff_id, min_interval=args.interval)
    from datetime import datetime, timezone

    for code in targets:
        try:
            data = client.search_items({"itemCode": code, "hits": 1})
        except NonRetryableAPIError:
            continue
        except Exception:
            continue
        items = data.get("Items", [])
        if not items:
            continue
        detail = items[0]["Item"]
        detail["fetched_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        details[code] = detail
        sc = detail.get("shopCode")
        if sc and sc not in shops_dict:
            shops_dict[sc] = {
                "shopCode": sc,
                "shopName": detail.get("shopName"),
                "shopUrl": detail.get("shopUrl"),
                "shopAffiliateUrl": detail.get("shopAffiliateUrl"),
            }

    with details_path.open("w", encoding="utf-8") as fw:
        for code in sorted(details.keys()):
            fw.write(json.dumps(details[code], ensure_ascii=False) + "\n")

    shops_list = list(shops_dict.values())
    shops_list.sort(key=lambda x: (x.get("shopName") or "", x.get("shopCode") or ""))
    shops_path.write_text(json.dumps(shops_list, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()


