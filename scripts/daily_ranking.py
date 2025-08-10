#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from .rakuten_client import RakutenAPIClient


def parse_args():
    p = argparse.ArgumentParser(description="日次ランキング収集 + 記事JSON生成")
    p.add_argument("--output-dir", default=".")
    p.add_argument("--genre", default="レディースファッション")
    p.add_argument("--top-n", type=int, default=10)
    p.add_argument("--interval", type=float, default=3.1)
    return p.parse_args()


def build_article_json(src_file: Path, genre_name: str, top_n: int, out_file: Path) -> bool:
    rows = []
    with src_file.open(encoding="utf-8") as f:
        for line in f:
            try:
                r = json.loads(line)
            except Exception:
                continue
            if r.get("genreName") != genre_name:
                continue
            rows.append(r)
    rows.sort(key=lambda x: x.get("rank", 999999))
    rows = rows[: max(1, int(top_n))]
    payload = []
    for it in rows:
        image_url = None
        mi = it.get("mediumImageUrls")
        if isinstance(mi, list) and mi:
            image_url = mi[0].get("imageUrl")
        payload.append({
            "rank": it.get("rank"),
            "itemName": it.get("itemName"),
            "itemPrice": int(it.get("itemPrice", 0)),
            "reviewCount": int(it.get("reviewCount", 0)),
            "reviewAverage": float(it.get("reviewAverage", 0.0)),
            "pointRate": int(it.get("pointRate", 0)),
            "pointRateStartTime": it.get("pointRateStartTime"),
            "pointRateEndTime": it.get("pointRateEndTime"),
            "affiliateUrl": it.get("affiliateUrl"),
            "imageUrl": image_url,
            "shopName": it.get("shopName"),
            "shopUrl": it.get("shopAffiliateUrl") or it.get("shopUrl"),
        })
    old = None
    if out_file.exists():
        try:
            old = json.loads(out_file.read_text(encoding="utf-8"))
        except Exception:
            pass
    if json.dumps(old, ensure_ascii=False, sort_keys=True) != json.dumps(payload, ensure_ascii=False, sort_keys=True):
        out_file.parent.mkdir(parents=True, exist_ok=True)
        out_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return True
    return False


def main():
    args = parse_args()
    app_id = os.environ.get("RAKUTEN_APP_ID")
    aff_id = os.environ.get("RAKUTEN_AFFILIATE_ID")
    if not app_id:
        raise SystemExit("RAKUTEN_APP_ID is required via environment variables")

    client = RakutenAPIClient(app_id, aff_id, min_interval=args.interval)

    # トップジャンル（rootのchildren）を巡回してランキング収集
    root = client.fetch_genre(0)
    genres = root.get("children", [])

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    fn = out_dir / f"ranking_{datetime.now(timezone.utc).strftime('%Y%m%d')}.jsonl"

    with fn.open("a", encoding="utf-8") as fw:
        for g in genres:
            child = g.get("child", {})
            gid = child.get("genreId")
            gname = child.get("genreName") or str(gid)
            try:
                data = client.fetch_ranking(gid, hits=30)
                for w in data.get("Items", []):
                    it = w.get("Item") or {}
                    rec = {"fetched_at": datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                           "genreId": gid, "genreName": gname, **it}
                    fw.write(json.dumps(rec, ensure_ascii=False) + "\n")
            except Exception:
                continue

    # 記事JSON生成（サイト相対パス）
    summary_path = Path("site_data/series001/001-001.json")
    changed = build_article_json(fn, args.genre, args.top_n, summary_path)
    print(f"ranking file: {fn}")
    print(f"article summary changed: {changed}")


if __name__ == "__main__":
    main()


