#!/usr/bin/env python3
from __future__ import annotations

import time
from typing import Dict, Optional

import requests


class NonRetryableAPIError(Exception):
    """400相当など、再試行しても改善しないエラー"""


class RakutenAPIClient:
    BASE_RANKING_URL = "https://app.rakuten.co.jp/services/api/IchibaItem/Ranking/20220601"
    BASE_GENRE_URL = "https://app.rakuten.co.jp/services/api/IchibaGenre/Search/20120723"
    BASE_SEARCH_URL = "https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601"

    def __init__(
        self,
        application_id: str,
        affiliate_id: Optional[str] = None,
        min_interval: float = 3.1,
        max_retries: int = 3,
        backoff_factor: float = 2.0,
    ) -> None:
        self.application_id = application_id
        self.affiliate_id = affiliate_id
        self.min_interval = max(min_interval, 1.0)
        self.max_retries = max_retries
        self.backoff_factor = backoff_factor
        self._last_request_ts: float = 0.0
        self.session = requests.Session()

    def _respect_rate_limit(self) -> None:
        delta = time.time() - self._last_request_ts
        wait = self.min_interval - delta
        if wait > 0:
            time.sleep(wait)

    def _request(self, url: str, params: Dict[str, str | int]) -> Dict:
        p = dict(params)
        p["applicationId"] = self.application_id
        if self.affiliate_id:
            p["affiliateId"] = self.affiliate_id

        for attempt in range(1, self.max_retries + 1):
            try:
                self._respect_rate_limit()
                resp = self.session.get(url, params=p, timeout=10)
                self._last_request_ts = time.time()
                if resp.status_code == 400:
                    raise NonRetryableAPIError(f"400 Bad Request: {resp.text[:120]}")
                resp.raise_for_status()
                data = resp.json()
                if isinstance(data, dict) and "error" in data:
                    raise NonRetryableAPIError(data.get("error_description", data["error"]))
                return data
            except NonRetryableAPIError:
                raise
            except Exception:
                if attempt == self.max_retries:
                    raise
                time.sleep(self.min_interval * (self.backoff_factor ** (attempt - 1)))
        raise RuntimeError("Max retries exceeded")

    def fetch_genre(self, genre_id: int | str = 0) -> Dict:
        return self._request(self.BASE_GENRE_URL, {"genreId": genre_id})

    def fetch_ranking(self, genre_id: int | str, hits: int = 30) -> Dict:
        return self._request(self.BASE_RANKING_URL, {"genreId": genre_id, "hits": hits})

    def search_items(self, params: Dict) -> Dict:
        return self._request(self.BASE_SEARCH_URL, params)


