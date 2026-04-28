import importlib.util
import os
from pathlib import Path
import unittest


SCRIPT_PATH = Path(__file__).with_name("uci_scraper.py")
spec = importlib.util.spec_from_file_location("uci_scraper", SCRIPT_PATH)
uci_scraper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uci_scraper)


def make_page(offset, count=100):
    return [
        {
            "rank": offset + index + 1,
            "rider_name": f"RIDER {offset + index + 1}",
            "team_name": "Test Team",
            "nationality": "DK",
            "points": 1000 - index,
        }
        for index in range(count)
    ]


class UciScraperValidationTests(unittest.TestCase):
    def test_fetch_rankings_accepts_sequential_pages(self):
        result = uci_scraper.fetch_rankings(
            300,
            min_expected=300,
            page_fetcher=lambda offset: make_page(offset),
        )

        self.assertEqual(len(result["riders"]), 300)
        self.assertEqual(result["pages_fetched"], 3)
        self.assertEqual(result["rank_min"], 1)
        self.assertEqual(result["rank_max"], 300)
        self.assertTrue(result["complete_ranking"])

    def test_fetch_rankings_rejects_repeated_top_100(self):
        with self.assertRaisesRegex(uci_scraper.ScraperValidationError, "pagination drift"):
            uci_scraper.fetch_rankings(
                200,
                min_expected=200,
                page_fetcher=lambda _offset: make_page(0),
            )

    def test_fetch_rankings_rejects_empty_page(self):
        def fetch_page(offset):
            if offset == 0:
                return make_page(0)
            return []

        with self.assertRaisesRegex(uci_scraper.ScraperValidationError, "tom side"):
            uci_scraper.fetch_rankings(200, min_expected=200, page_fetcher=fetch_page)

    def test_fetch_rankings_rejects_rank_gap(self):
        page = make_page(0)
        page[50]["rank"] = 999

        with self.assertRaisesRegex(uci_scraper.ScraperValidationError, "rank-gap"):
            uci_scraper.fetch_rankings(100, min_expected=100, page_fetcher=lambda _offset: page)

    def test_fetch_rankings_enforces_coverage_gate(self):
        with self.assertRaisesRegex(uci_scraper.ScraperValidationError, "Coverage-gate"):
            uci_scraper.fetch_rankings(
                3000,
                min_expected=2400,
                page_fetcher=lambda _offset: make_page(0, count=50),
            )

    def test_sync_supabase_rejects_mass_minimum_downgrade(self):
        class FakeResponse:
            def __init__(self, payload):
                self.payload = payload

            def raise_for_status(self):
                return None

            def json(self):
                return self.payload

        class FakeRequests:
            def get(self, *_args, **_kwargs):
                return FakeResponse([
                    {
                        "id": index,
                        "firstname": f"Firstname{index}",
                        "lastname": f"Lastname{index}",
                        "uci_points": 100,
                    }
                    for index in range(30)
                ])

        old_requests = uci_scraper.requests
        old_url = os.environ.get("SUPABASE_URL")
        old_key = os.environ.get("SUPABASE_SERVICE_KEY")
        try:
            uci_scraper.requests = FakeRequests()
            os.environ["SUPABASE_URL"] = "https://example.supabase.co"
            os.environ["SUPABASE_SERVICE_KEY"] = "service-key"
            with self.assertRaisesRegex(uci_scraper.ScraperValidationError, "Safety-gate"):
                uci_scraper.sync_supabase([], "2026-04-28T00:00:00Z", False, True)
        finally:
            uci_scraper.requests = old_requests
            if old_url is None:
                os.environ.pop("SUPABASE_URL", None)
            else:
                os.environ["SUPABASE_URL"] = old_url
            if old_key is None:
                os.environ.pop("SUPABASE_SERVICE_KEY", None)
            else:
                os.environ["SUPABASE_SERVICE_KEY"] = old_key


if __name__ == "__main__":
    unittest.main()
