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
        # Brug uci_points=50 (under HIGH_VALUE_UCI_POINTS_THRESHOLD=100) og popularity=0
        # så safety-gate vurderer det som mass-downgrade frem for high-value-protection.
        fake_riders = [
            {
                "id": index,
                "firstname": f"Firstname{index}",
                "lastname": f"Lastname{index}",
                "uci_points": 50,
                "popularity": 0,
            }
            for index in range(30)
        ]
        with _supabase_fake(fake_riders):
            with self.assertRaisesRegex(uci_scraper.ScraperValidationError, "Safety-gate"):
                uci_scraper.sync_supabase([], "2026-04-28T00:00:00Z", False, True)

    def test_sync_supabase_fetches_all_db_rider_pages(self):
        fake_riders = [
            {
                "id": index,
                "firstname": "Rider",
                "lastname": str(index),
                "uci_points": 5,
                "popularity": 0,
            }
            for index in range(2501)
        ]
        with _supabase_fake(fake_riders) as fake:
            uci_scraper.sync_supabase(
                [{"rider_name": "RIDER 1", "points": 100}],
                "2026-05-13T00:00:00Z",
                dry_run=True,
                complete_ranking=True,
            )
            self.assertEqual(len(fake.get_ranges), 3)
            self.assertEqual(fake.get_ranges, [(0, 999), (1000, 1999), (2000, 2999)])


class NormalizeNameTests(unittest.TestCase):
    """Sikrer at normalisering håndterer kendte mismatch-kilder ensartet."""

    def test_handles_danish_vowels(self):
        self.assertEqual(uci_scraper.normalize_name("Søjberg"), "SOEJBERG")
        self.assertEqual(uci_scraper.normalize_name("Mørkøv"), "MOERKOEV")
        self.assertEqual(uci_scraper.normalize_name("Resell"), "RESELL")
        self.assertEqual(uci_scraper.normalize_name("Nordsæter"), "NORDSAETER")
        self.assertEqual(uci_scraper.normalize_name("Århus"), "AARHUS")

    def test_handles_polish_l(self):
        self.assertEqual(uci_scraper.normalize_name("ANIOŁKOWSKI"), "ANIOLKOWSKI")
        self.assertEqual(uci_scraper.normalize_name("Bogusławski"), "BOGUSLAWSKI")

    def test_strips_combining_accents(self):
        self.assertEqual(uci_scraper.normalize_name("Honoré"), "HONORE")
        self.assertEqual(uci_scraper.normalize_name("Ramírez"), "RAMIREZ")
        self.assertEqual(uci_scraper.normalize_name("POGAČAR"), "POGACAR")
        self.assertEqual(uci_scraper.normalize_name("Iván"), "IVAN")

    def test_treats_hyphen_apostrophe_period_as_whitespace(self):
        self.assertEqual(uci_scraper.normalize_name("Lund-Andresen"), "LUND ANDRESEN")
        self.assertEqual(uci_scraper.normalize_name("O'Connor"), "O CONNOR")
        self.assertEqual(uci_scraper.normalize_name("T. Lund"), "T LUND")

    def test_collapses_whitespace(self):
        self.assertEqual(uci_scraper.normalize_name("  Foo   Bar  "), "FOO BAR")


class FindUciMatchTests(unittest.TestCase):
    """Token-set-baseret match skal fange compound surnames og middle-name-drift."""

    def _map_for(self, *names_and_pts):
        return {uci_scraper.name_tokens(n): p for n, p in names_and_pts}

    def test_exact_token_set_match_handles_compound_surname(self):
        # DB lastname="Lund Andresen", UCI sender "ANDRESEN Tobias Lund" — samme token-set.
        rider = {"firstname": "Tobias", "lastname": "Lund Andresen"}
        uci_map = self._map_for(("ANDRESEN Tobias Lund", 2514))
        self.assertEqual(uci_scraper.find_uci_match(rider, uci_map), 2514)

    def test_exact_token_set_match_halland_johannessen(self):
        rider = {"firstname": "Tobias", "lastname": "Halland Johannessen"}
        uci_map = self._map_for(("JOHANNESSEN Tobias Halland", 2393))
        self.assertEqual(uci_scraper.find_uci_match(rider, uci_map), 2393)

    def test_db_subset_of_uci_matches_when_uci_has_extra_middle(self):
        # DB "Mikkel Honoré", UCI "HONORÉ Mikkel Frølich" — DB ⊆ UCI.
        rider = {"firstname": "Mikkel", "lastname": "Honoré"}
        uci_map = self._map_for(("HONORÉ Mikkel Frølich", 418))
        self.assertEqual(uci_scraper.find_uci_match(rider, uci_map), 418)

    def test_uci_subset_of_db_matches_when_db_has_extra_middle(self):
        # DB "Mateo Pablo Ramírez", UCI "RAMÍREZ Mateo" — UCI ⊆ DB (med min. 2 tokens).
        rider = {"firstname": "Mateo Pablo", "lastname": "Ramírez"}
        uci_map = self._map_for(("RAMÍREZ Mateo", 43))
        self.assertEqual(uci_scraper.find_uci_match(rider, uci_map), 43)

    def test_polish_l_normalizes_to_l(self):
        rider = {"firstname": "Stanislaw", "lastname": "Aniolkowski"}
        uci_map = self._map_for(("ANIOŁKOWSKI Stanislaw", 905))
        self.assertEqual(uci_scraper.find_uci_match(rider, uci_map), 905)

    def test_hyphenated_lastname_matches_space_variant(self):
        # PCS kunne sende "MARTIN-GUYONNET Guillaume" eller "MARTIN GUYONNET Guillaume" —
        # bindestreg → mellemrum gør begge variant token-equivalente.
        rider = {"firstname": "Guillaume", "lastname": "Martin-Guyonnet"}
        uci_map = self._map_for(("MARTIN-GUYONNET Guillaume", 379))
        self.assertEqual(uci_scraper.find_uci_match(rider, uci_map), 379)

    def test_no_match_returns_none_for_unknown_rider(self):
        rider = {"firstname": "John", "lastname": "Nobody"}
        uci_map = self._map_for(("POGACAR Tadej", 10000))
        self.assertIsNone(uci_scraper.find_uci_match(rider, uci_map))


class HighValueProtectionTests(unittest.TestCase):
    """High-value safety-gate: aldrig auto-downgrade kendte ryttere til MIN ved name-mismatch."""

    def test_high_popularity_rider_keeps_points_when_unmatched(self):
        # Rider med popularity=80 (≥70) og uci_points=2514 og INGEN match i UCI-map
        # skal bevare 2514 — ikke nedskrives til MIN (5).
        fake_riders = [{
            "id": 1,
            "firstname": "Tobias",
            "lastname": "Lund Andresen",
            "uci_points": 2514,
            "popularity": 80,
        }]
        with _supabase_fake(fake_riders) as fake:
            uci_scraper.sync_supabase(
                [{"rider_name": "POGACAR Tadej", "points": 10000}],
                "2026-05-04T00:00:00Z",
                dry_run=False,
                complete_ranking=True,
            )
            # Ingen PATCH-kald skulle være lavet (ryttere blev beskyttet)
            self.assertEqual(fake.patches, [])

    def test_high_uci_points_rider_keeps_points_when_unmatched(self):
        # Rider med popularity=0 men uci_points=500 (≥100) skal også beskyttes.
        fake_riders = [{
            "id": 2,
            "firstname": "Some",
            "lastname": "Rider",
            "uci_points": 500,
            "popularity": 0,
        }]
        with _supabase_fake(fake_riders) as fake:
            uci_scraper.sync_supabase(
                [{"rider_name": "POGACAR Tadej", "points": 10000}],
                "2026-05-04T00:00:00Z",
                dry_run=False,
                complete_ranking=True,
            )
            self.assertEqual(fake.patches, [])

    def test_low_value_unmatched_rider_downgrades_to_min(self):
        fake_riders = [{
            "id": 3,
            "firstname": "Continental",
            "lastname": "Unknown",
            "uci_points": 50,  # < 100
            "popularity": 0,   # < 70
        }]
        with _supabase_fake(fake_riders) as fake:
            uci_scraper.sync_supabase(
                [{"rider_name": "POGACAR Tadej", "points": 10000}],
                "2026-05-04T00:00:00Z",
                dry_run=False,
                complete_ranking=True,
            )
            self.assertEqual(len(fake.patches), 1)
            self.assertEqual(fake.patches[0]["uci_points"], uci_scraper.MIN_UCI_POINTS)


# ── Test helpers ────────────────────────────────────────────────────────────

class _FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class _FakeRequests:
    def __init__(self, db_riders):
        self.db_riders = db_riders
        self.get_ranges: list[tuple[int, int] | None] = []
        self.patches: list[dict] = []
        self.posts: list[dict] = []

    def get(self, *_args, headers=None, **_kwargs):
        range_header = (headers or {}).get("Range")
        if not range_header:
            self.get_ranges.append(None)
            return _FakeResponse(list(self.db_riders))
        start_s, end_s = range_header.split("-", 1)
        start = int(start_s)
        end = int(end_s)
        self.get_ranges.append((start, end))
        return _FakeResponse(list(self.db_riders[start:end + 1]))

    def patch(self, _url, json=None, **_kwargs):
        if json:
            self.patches.append(json)
        return _FakeResponse(None)

    def post(self, _url, json=None, **_kwargs):
        if json:
            self.posts.append(json)
        return _FakeResponse(None)


from contextlib import contextmanager


@contextmanager
def _supabase_fake(db_riders):
    fake = _FakeRequests(db_riders)
    old_requests = uci_scraper.requests
    old_url = os.environ.get("SUPABASE_URL")
    old_key = os.environ.get("SUPABASE_SERVICE_KEY")
    try:
        uci_scraper.requests = fake
        os.environ["SUPABASE_URL"] = "https://example.supabase.co"
        os.environ["SUPABASE_SERVICE_KEY"] = "service-key"
        yield fake
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
