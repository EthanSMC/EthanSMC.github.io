import os
import unittest
from datetime import date, timedelta

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("PORTFOLIO_URL", "http://127.0.0.1:4173/")
NO_CONTRIBUTION_ROUTE = object()


def contribution_fixture():
    first = date(2025, 7, 15)
    last = date(2026, 7, 14)
    weeks = {}
    current = first
    while current <= last:
        weekday = (current.weekday() + 1) % 7
        sunday = current - timedelta(days=weekday)
        count = (current.toordinal() * 7) % 9
        level = 0 if count == 0 else min(4, (count + 1) // 2)
        weeks.setdefault(sunday, []).append({
            "date": current.isoformat(),
            "count": count,
            "level": level,
        })
        current += timedelta(days=1)
    return {
        "username": "EthanSMC",
        "from": first.isoformat(),
        "to": last.isoformat(),
        "total": sum(day["count"] for days in weeks.values() for day in days),
        "weeks": [{"days": days} for _, days in sorted(weeks.items())],
    }


EXPECTED_PROJECT_TITLES = [
    "AI-native Wealth & Asset Management System",
    "Bond Agent & Financial Q",
    "Novelty Studio",
]
EXPECTED_REPOSITORIES = [
    ("pm-skills", "https://github.com/EthanSMC/pm-skills"),
    ("digital-me", "https://github.com/EthanSMC/digital-me"),
    ("mcd-skill", "https://github.com/EthanSMC/mcd-skill"),
    ("learn-back", "https://github.com/EthanSMC/learn-back"),
]
EXPECTED_FEATURED_PROJECT_EXTERNAL_LINKS = [
    {
        "projectTitle": "Novelty Studio",
        "href": "https://noveltystudio.cn",
        "target": "_blank",
    }
]
FIRST_VIEW_WALL_SELECTOR = (
    ".focus-note, .tools-note, .terminal-note, .repo-stack, [data-project-board]"
)
DISABLE_WEBGL_SCRIPT = """
(() => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...args) {
    const contextType = String(type).toLowerCase();
    if (["webgl", "webgl2", "experimental-webgl"].includes(contextType)) {
      return null;
    }
    return originalGetContext.call(this, type, ...args);
  };
})();
"""


class PortfolioE2E(unittest.TestCase):
    maxDiff = None

    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def open_page(
        self,
        width=1440,
        height=1000,
        reduced_motion=False,
        disable_webgl=False,
        contribution_payload=NO_CONTRIBUTION_ROUTE,
        contribution_status=200,
    ):
        context = self.browser.new_context(viewport={"width": width, "height": height})
        self.addCleanup(context.close)
        if disable_webgl:
            context.add_init_script(DISABLE_WEBGL_SCRIPT)
        page = context.new_page()
        if reduced_motion:
            page.emulate_media(reduced_motion="reduce")
        if contribution_payload is not NO_CONTRIBUTION_ROUTE:
            page.route(
                "**/api/github-contributions",
                lambda route: route.fulfill(
                    status=contribution_status,
                    json=contribution_payload,
                ),
            )
        page.goto(BASE_URL, wait_until="networkidle")
        return page

    def assert_element_readable(self, locator):
        state = locator.evaluate(
            """element => {
              const style = getComputedStyle(element);
              const bounds = element.getBoundingClientRect();
              return {
                display: style.display,
                visibility: style.visibility,
                opacity: Number(style.opacity),
                width: bounds.width,
                height: bounds.height,
                intersectsViewport:
                  bounds.bottom > 0 && bounds.top < window.innerHeight &&
                  bounds.right > 0 && bounds.left < window.innerWidth,
              };
            }"""
        )
        self.assertNotEqual(state["display"], "none", state)
        self.assertEqual(state["visibility"], "visible", state)
        self.assertGreater(state["opacity"], 0.8, state)
        self.assertGreater(state["width"], 0, state)
        self.assertGreater(state["height"], 0, state)
        self.assertTrue(state["intersectsViewport"], state)

    def scroll_intro_to(self, page, progress):
        intro = page.locator("[data-intro]")
        self.assertEqual(intro.count(), 1)
        intro_box = intro.bounding_box()
        self.assertIsNotNone(intro_box)
        viewport_height = page.evaluate("window.innerHeight")
        scroll_range = max(intro_box["height"] - viewport_height, 1)
        page.evaluate(
            "y => window.scrollTo(0, y)",
            intro_box["y"] + scroll_range * progress,
        )
        page.wait_for_timeout(1000)

    def content_and_link_snapshot(self, page):
        return page.evaluate(
            r"""() => {
              const normalizedText = element =>
                element ? element.textContent.replace(/\s+/g, " ").trim() : null;
              const linkSummary = element => element ? {
                label: normalizedText(element),
                href: element.getAttribute("href"),
                target: element.getAttribute("target"),
              } : null;

              return {
                projects: [...document.querySelectorAll("[data-project-card]")].map(card => ({
                  title: normalizedText(card.querySelector("h3")),
                  links: [...card.querySelectorAll("a")].map(link => ({
                    href: link.getAttribute("href"),
                    target: link.getAttribute("target"),
                  })),
                })),
                repositories: [...document.querySelectorAll("#repos .repo-card")].map(card => ({
                  name: normalizedText(card.querySelector("h3")),
                  tag: card.tagName,
                  href: card.getAttribute("href"),
                  target: card.getAttribute("target"),
                })),
                viewAllRepositories: linkSummary(
                  document.querySelector("#repos .section-heading > a")
                ),
                designCredit: linkSummary(
                  document.querySelector("footer.site-footer .design-credit a")
                ),
                externalTargetOffenders: [...document.querySelectorAll("a[href]")]
                  .filter(anchor => {
                    const href = anchor.getAttribute("href") || "";
                    return /^https?:\/\//i.test(href) &&
                      anchor.hasAttribute("target") &&
                      href !== "https://noveltystudio.cn";
                  })
                  .map(linkSummary),
              };
            }"""
        )

    def external_http_links(self, page):
        return page.locator("a[href]").evaluate_all(
            r"""anchors => anchors
              .filter(anchor => /^https?:\/\//i.test(anchor.getAttribute("href") || ""))
              .map(anchor => ({
                label: anchor.textContent.replace(/\s+/g, " ").trim(),
                href: anchor.getAttribute("href"),
                target: anchor.getAttribute("target"),
              }))"""
        )

    def featured_project_external_links(self, page):
        return page.locator("#projects a[href]").evaluate_all(
            r"""anchors => anchors
              .filter(anchor => /^https?:\/\//i.test(anchor.getAttribute("href") || ""))
              .map(anchor => {
                const card = anchor.closest("[data-project-card]");
                return {
                  projectTitle: card?.querySelector("h3")?.textContent.trim() || null,
                  href: anchor.getAttribute("href"),
                  target: anchor.getAttribute("target"),
                };
              })"""
        )

    def test_content_and_link_contract(self):
        page = self.open_page()
        snapshot = self.content_and_link_snapshot(page)
        featured_project_links = self.featured_project_external_links(page)
        expected_projects = [
            {"title": EXPECTED_PROJECT_TITLES[0], "links": []},
            {"title": EXPECTED_PROJECT_TITLES[1], "links": []},
            {
                "title": EXPECTED_PROJECT_TITLES[2],
                "links": [
                    {
                        "href": "https://noveltystudio.cn",
                        "target": "_blank",
                    }
                ],
            },
        ]
        expected_repositories = [
            {"name": name, "tag": "A", "href": href, "target": None}
            for name, href in EXPECTED_REPOSITORIES
        ]
        expected_view_all = {
            "label": "View all repos",
            "href": "https://github.com/EthanSMC?tab=repositories",
            "target": None,
        }
        expected_credit = {
            "label": "David Heckhoff",
            "href": "https://david-hckh.com/",
            "target": None,
        }

        issues = []
        if snapshot["projects"] != expected_projects:
            issues.append(
                f"projects: expected {expected_projects!r}, got {snapshot['projects']!r}"
            )
        if featured_project_links != EXPECTED_FEATURED_PROJECT_EXTERNAL_LINKS:
            issues.append(
                "Featured Projects external links: "
                f"expected {EXPECTED_FEATURED_PROJECT_EXTERNAL_LINKS!r}, "
                f"got {featured_project_links!r}"
            )
        if snapshot["repositories"] != expected_repositories:
            issues.append(
                "repositories: "
                f"expected {expected_repositories!r}, got {snapshot['repositories']!r}"
            )
        if snapshot["viewAllRepositories"] != expected_view_all:
            issues.append(
                "View all repos: "
                f"expected {expected_view_all!r}, got {snapshot['viewAllRepositories']!r}"
            )
        if snapshot["designCredit"] != expected_credit:
            issues.append(
                f"design credit: expected {expected_credit!r}, got {snapshot['designCredit']!r}"
            )
        if snapshot["externalTargetOffenders"]:
            issues.append(
                "external anchors with target attributes: "
                f"{snapshot['externalTargetOffenders']!r}"
            )

        self.assertEqual(
            issues,
            [],
            "Content/link contract violations:\n- " + "\n- ".join(issues),
        )

    def test_only_novelty_studio_opens_in_a_new_tab(self):
        page = self.open_page()
        links = self.external_http_links(page)
        self.assertGreater(len(links), 0, "Expected at least one external HTTP(S) link")

        for index, link in enumerate(links):
            with self.subTest(
                anchor=index + 1,
                label=link["label"],
                href=link["href"],
            ):
                expected_target = (
                    "_blank"
                    if link["href"] == "https://noveltystudio.cn"
                    else None
                )
                self.assertEqual(link["target"], expected_target)

    def test_featured_projects_has_only_novelty_external_link(self):
        page = self.open_page()
        links = self.featured_project_external_links(page)
        self.assertEqual(
            links,
            EXPECTED_FEATURED_PROJECT_EXTERNAL_LINKS,
            "Featured Projects must expose only the new-tab Novelty Studio link",
        )

    def test_project_titles_are_exact(self):
        page = self.open_page()
        cards = page.locator("[data-project-card]")

        with self.subTest(contract="project count"):
            self.assertEqual(cards.count(), 3)
        for index, expected in enumerate(EXPECTED_PROJECT_TITLES):
            headings = cards.nth(index).locator("h3")
            heading_count = headings.count()
            with self.subTest(project=index + 1, contract="one h3"):
                self.assertEqual(heading_count, 1)
            if heading_count == 1:
                with self.subTest(project=index + 1, contract="title"):
                    self.assertEqual(headings.inner_text(), expected)

    def test_project_links_are_intentional(self):
        page = self.open_page()
        cards = page.locator("[data-project-card]")

        for index in (0, 1):
            with self.subTest(project=index + 1, contract="link-free"):
                self.assertEqual(cards.nth(index).locator("a").count(), 0)

        novelty_links = cards.nth(2).locator("a")
        novelty_link_count = novelty_links.count()
        with self.subTest(project=3, contract="one anchor"):
            self.assertEqual(novelty_link_count, 1)
        if novelty_link_count == 1:
            novelty_link = novelty_links.first
            with self.subTest(project=3, contract="href"):
                self.assertEqual(
                    novelty_link.get_attribute("href"),
                    "https://noveltystudio.cn",
                )
            with self.subTest(project=3, contract="new tab"):
                self.assertEqual(novelty_link.get_attribute("target"), "_blank")
            with self.subTest(project=3, contract="secure opener"):
                self.assertEqual(
                    novelty_link.get_attribute("rel"),
                    "noopener noreferrer",
                )
            with self.subTest(project=3, contract="full-card click target"):
                cards.nth(2).scroll_into_view_if_needed()
                hit_target = cards.nth(2).locator(".project-shot").evaluate(
                    """shot => {
                      const bounds = shot.getBoundingClientRect();
                      const hit = document.elementFromPoint(
                        bounds.left + bounds.width / 2,
                        bounds.top + bounds.height / 2
                      );
                      const link = hit?.closest("a");
                      return link ? {
                        href: link.getAttribute("href"),
                        target: link.getAttribute("target"),
                      } : null;
                    }"""
                )
                self.assertEqual(
                    hit_target,
                    {
                        "href": "https://noveltystudio.cn",
                        "target": "_blank",
                    },
                )

    def test_bond_project_uses_domain_visual(self):
        page = self.open_page()
        bond_card = page.locator("[data-project-card]").nth(1)

        self.assertEqual(bond_card.locator(".project-shot.bond-flow").count(), 1)
        self.assertEqual(bond_card.locator(".project-shot img").count(), 0)
        self.assertGreaterEqual(bond_card.locator("[data-bond-row]").count(), 3)

    def test_say_hi_opens_wechat_qr_dialog(self):
        page = self.open_page()
        trigger = page.locator("[data-wechat-open]")
        self.assertEqual(trigger.count(), 1)
        self.assertEqual(trigger.evaluate("element => element.tagName"), "BUTTON")

        trigger.click()
        dialog = page.locator("#wechat-dialog")
        self.assertTrue(dialog.evaluate("element => element.open"))

        qr = dialog.locator("img[data-wechat-qr]")
        self.assertEqual(qr.get_attribute("src"), "assets/wechat-qr.jpg")
        self.assertGreater(qr.evaluate("image => image.naturalWidth"), 0)

        page.keyboard.press("Escape")
        self.assertFalse(dialog.evaluate("element => element.open"))

    def test_repository_cards_are_exact_same_tab_anchors(self):
        page = self.open_page()
        cards = page.locator("#repos .repo-card")
        records = cards.evaluate_all(
            """elements => elements.map(element => ({
              name: element.querySelector("h3")?.textContent.trim() || "",
              tag: element.tagName,
              href: element.getAttribute("href"),
              target: element.getAttribute("target"),
            }))"""
        )

        with self.subTest(contract="repository count"):
            self.assertEqual(len(records), 4)
        with self.subTest(contract="repository order"):
            self.assertEqual(
                [record["name"] for record in records],
                [name for name, _ in EXPECTED_REPOSITORIES],
            )

        for record in records:
            with self.subTest(repository=record["name"], contract="anchor"):
                self.assertEqual(record["tag"], "A")
            with self.subTest(repository=record["name"], contract="same tab"):
                self.assertIsNone(record["target"])

        for name, expected_href in EXPECTED_REPOSITORIES:
            matches = [record for record in records if record["name"] == name]
            with self.subTest(repository=name, contract="featured exactly once"):
                self.assertEqual(len(matches), 1)
            if len(matches) == 1:
                with self.subTest(repository=name, contract="href"):
                    self.assertEqual(matches[0]["href"], expected_href)

        with self.subTest(contract="jinshi-finpm not featured"):
            self.assertNotIn("jinshi-finpm", [record["name"] for record in records])

    def test_contribution_note_follows_repository_cards(self):
        page = self.open_page()
        note = page.locator("[data-contributions]")
        self.assertEqual(note.count(), 1)
        self.assertEqual(note.locator("h3").inner_text(), "365 days of making")
        self.assertEqual(
            note.get_attribute("aria-labelledby"),
            "contributions-title",
        )
        self.assertTrue(
            page.evaluate(
                """() => {
              const cards = document.querySelector("#repos .repo-cards");
              const note = document.querySelector("[data-contributions]");
              return cards?.nextElementSibling === note;
            }"""
            )
        )

    def test_contribution_heatmap_renders_live_payload(self):
        payload = contribution_fixture()
        page = self.open_page(contribution_payload=payload)
        note = page.locator("[data-contributions]")
        note.scroll_into_view_if_needed()
        page.wait_for_function(
            "document.querySelector('[data-contributions]')?.dataset.state === 'ready'"
        )
        cells = note.locator("[data-contribution-grid] > *")
        self.assertEqual(cells.count(), 371)
        self.assertEqual(note.locator("[data-contribution-day]").count(), 365)
        self.assertEqual(cells.nth(2).get_attribute("data-week-index"), "0")
        self.assertEqual(cells.nth(2).get_attribute("data-weekday"), "2")
        self.assertEqual(cells.nth(366).get_attribute("data-week-index"), "52")
        self.assertEqual(cells.nth(366).get_attribute("data-weekday"), "2")
        self.assertEqual(
            note.locator("[data-contribution-total]").inner_text(),
            f"{payload['total']:,} contributions",
        )
        self.assertEqual(
            note.locator("[data-contribution-grid]").get_attribute("aria-busy"),
            "false",
        )

    def test_contribution_heatmap_keyboard_and_tooltip(self):
        page = self.open_page(contribution_payload=contribution_fixture())
        page.wait_for_function(
            "document.querySelector('[data-contributions]')?.dataset.state === 'ready'"
        )
        start = page.locator(
            '[data-contribution-day][data-week-index="1"][data-weekday="2"]'
        )
        start.focus()
        page.keyboard.press("ArrowRight")
        focused = page.locator(":focus")
        self.assertEqual(focused.get_attribute("data-week-index"), "2")
        self.assertEqual(focused.get_attribute("tabindex"), "0")
        self.assertEqual(
            page.locator('[data-contribution-day][tabindex="0"]').count(),
            1,
        )
        tooltip = page.locator("[data-contribution-tooltip]")
        self.assertFalse(tooltip.is_hidden())
        self.assertIn("contribution", tooltip.inner_text())

        original_url = page.url
        focused.click()
        self.assertEqual(page.url, original_url)

        for selector in (
            '[data-contribution-day][data-week-index="0"][data-weekday="2"]',
            '[data-contribution-day][data-week-index="52"][data-weekday="2"]',
        ):
            page.locator(selector).focus()
            bounds = page.evaluate(
                """() => {
                  const wrap = document.querySelector('.contribution-calendar-wrap')
                    .getBoundingClientRect();
                  const tip = document.querySelector('[data-contribution-tooltip]')
                    .getBoundingClientRect();
                  return { wrap, tip };
                }"""
            )
            self.assertGreaterEqual(bounds["tip"]["left"], bounds["wrap"]["left"] - 1)
            self.assertLessEqual(bounds["tip"]["right"], bounds["wrap"]["right"] + 1)

    def test_contribution_heatmap_rejects_malformed_payload(self):
        payload = contribution_fixture()
        payload["weeks"][0]["days"][0]["date"] = "2025-02-30"
        page = self.open_page(contribution_payload=payload)
        page.wait_for_function(
            "document.querySelector('[data-contributions]')?.dataset.state !== 'loading'"
        )
        self.assertEqual(
            page.locator("[data-contributions]").get_attribute("data-state"),
            "unavailable",
        )

    def test_contribution_heatmap_failure_is_usable(self):
        page = self.open_page(
            contribution_payload={"error": "Contribution data unavailable"},
            contribution_status=503,
        )
        page.wait_for_function(
            "document.querySelector('[data-contributions]')?.dataset.state === 'unavailable'"
        )
        note = page.locator("[data-contributions]")
        self.assertIn(
            "temporarily unavailable",
            note.locator("[data-contribution-status]").inner_text(),
        )
        self.assertEqual(
            note.locator('a[href="https://github.com/EthanSMC"]').count(),
            1,
        )

    def test_view_all_repositories_is_same_tab(self):
        page = self.open_page()
        view_all = page.locator("#repos .section-heading > a")
        link_count = view_all.count()
        with self.subTest(contract="one View all repos link"):
            self.assertEqual(link_count, 1)
        if link_count == 1:
            with self.subTest(contract="View all repos label"):
                self.assertEqual(view_all.inner_text(), "View all repos")
            with self.subTest(contract="View all repos href"):
                self.assertEqual(
                    view_all.get_attribute("href"),
                    "https://github.com/EthanSMC?tab=repositories",
                )
            with self.subTest(contract="View all repos same tab"):
                self.assertIsNone(view_all.get_attribute("target"))

    def test_footer_has_visible_david_heckhoff_credit(self):
        page = self.open_page()
        credit = page.locator("footer.site-footer .design-credit")
        credit_count = credit.count()
        with self.subTest(contract="one design credit"):
            self.assertEqual(credit_count, 1)
        if credit_count == 1:
            credit.scroll_into_view_if_needed()
            with self.subTest(contract="credit is readable"):
                self.assert_element_readable(credit)

            link = credit.locator("a")
            link_count = link.count()
            with self.subTest(contract="one David Heckhoff link"):
                self.assertEqual(link_count, 1)
            if link_count == 1:
                with self.subTest(contract="David Heckhoff label"):
                    self.assertEqual(link.inner_text(), "David Heckhoff")
                with self.subTest(contract="David Heckhoff link is readable"):
                    self.assert_element_readable(link)
                with self.subTest(contract="David Heckhoff href"):
                    self.assertEqual(link.get_attribute("href"), "https://david-hckh.com/")
                with self.subTest(contract="David Heckhoff same tab"):
                    self.assertIsNone(link.get_attribute("target"))

    def test_intro_structure_is_staged(self):
        page = self.open_page()
        intro = page.locator("[data-intro]")
        stage = page.locator("[data-intro-stage]")
        callouts = page.locator("[data-intro-callout]")

        with self.subTest(contract="one intro sequence"):
            self.assertEqual(intro.count(), 1)
        with self.subTest(contract="one intro stage"):
            self.assertEqual(stage.count(), 1)
        with self.subTest(contract="four intro callouts"):
            self.assertEqual(callouts.count(), 4)
        if stage.count() == 1:
            with self.subTest(contract="initial hero phase"):
                self.assertEqual(stage.get_attribute("data-phase"), "hero")

    def test_first_viewport_is_quiet(self):
        page = self.open_page()
        wall_elements = page.locator(FIRST_VIEW_WALL_SELECTOR)
        intersecting = wall_elements.evaluate_all(
            """elements => elements
              .filter(element => {
                const bounds = element.getBoundingClientRect();
                return bounds.width > 0 && bounds.height > 0 &&
                  bounds.bottom > 0 && bounds.top < window.innerHeight &&
                  bounds.right > 0 && bounds.left < window.innerWidth;
              })
              .map(element =>
                element.className || element.getAttribute("data-project-board") || element.tagName
              )"""
        )
        self.assertEqual(intersecting, [])

        intro_stage = page.locator("[data-intro-stage]")
        if intro_stage.count() == 1:
            self.assertEqual(intro_stage.locator(FIRST_VIEW_WALL_SELECTOR).count(), 0)

    def test_intro_scroll_reveals_all_callouts(self):
        page = self.open_page()
        self.scroll_intro_to(page, 0.82)

        with self.subTest(contract="domain phase"):
            self.assertEqual(
                page.locator("[data-intro-stage]").get_attribute("data-phase"),
                "domain",
            )
        visible = page.locator("[data-intro-callout]").evaluate_all(
            "els => els.filter(el => Number(getComputedStyle(el).opacity) > 0.8).length"
        )
        with self.subTest(contract="all callouts visible"):
            self.assertEqual(visible, 4)

    def test_contact_navigation_aligns_heading(self):
        page = self.open_page(width=1024, height=900)
        page.locator(".nav-links a[href='#contact']").click()
        page.wait_for_function("location.hash === '#contact'")
        page.wait_for_timeout(1000)
        top = page.locator("#contact-title").evaluate("el => el.getBoundingClientRect().top")
        self.assertGreaterEqual(top, 64)
        self.assertLessEqual(top, 144)

    def test_about_navigation_targets_about_phase_and_active_link(self):
        for width, height in [(1440, 1000), (390, 844)]:
            with self.subTest(width=width):
                page = self.open_page(width=width, height=height)
                page.locator(".nav-links a[href='#contact']").click()
                page.wait_for_function("location.hash === '#contact'")
                page.wait_for_timeout(500)

                page.locator(".nav-links a[href='#about']").click()
                page.wait_for_function("location.hash === '#about'")
                page.wait_for_timeout(1800)

                state = page.evaluate(
                    """() => {
                      const intro = document.querySelector('[data-intro]');
                      const range = Math.max(intro.offsetHeight - innerHeight, 1);
                      return {
                        progress: (scrollY - intro.offsetTop) / range,
                        phase: document.querySelector('[data-intro-stage]').dataset.phase,
                        active: document.querySelector('.nav-links a.active')?.getAttribute('href'),
                        visibleCallouts: [...document.querySelectorAll('[data-intro-callout]')]
                          .filter(element => Number(getComputedStyle(element).opacity) > 0.8).length,
                      };
                    }"""
                )
                self.assertAlmostEqual(state["progress"], 0.82, delta=0.03)
                self.assertEqual(state["phase"], "domain")
                self.assertEqual(state["active"], "#about")
                self.assertEqual(state["visibleCallouts"], 4)

    def test_about_navigation_reduced_motion_aligns_first_callout(self):
        page = self.open_page(width=390, height=844, reduced_motion=True)
        page.locator(".nav-links a[href='#contact']").click()
        page.locator(".nav-links a[href='#about']").click()
        page.wait_for_timeout(100)

        state = page.evaluate(
            """() => ({
              active: document.querySelector('.nav-links a.active')?.getAttribute('href'),
              firstTop: document.querySelector('[data-intro-callout]').getBoundingClientRect().top,
            })"""
        )
        self.assertEqual(state["active"], "#about")
        self.assertGreaterEqual(state["firstTop"], 64)
        self.assertLessEqual(state["firstTop"], 144)

    def test_reduced_motion_keeps_intro_content(self):
        page = self.open_page(width=390, height=844, reduced_motion=True)
        callouts = page.locator("[data-intro-callout]")
        callout_count = callouts.count()
        self.assertEqual(callout_count, 4)

        for index in range(callout_count):
            callout = callouts.nth(index)
            callout.scroll_into_view_if_needed()
            with self.subTest(callout=index + 1, contract="computed visibility"):
                self.assert_element_readable(callout)

    def test_webgl_failure_keeps_static_intro_readable(self):
        page = self.open_page(disable_webgl=True)
        disabled_contexts = page.evaluate(
            """() => {
              const canvas = document.createElement("canvas");
              return {
                webgl: canvas.getContext("webgl") === null,
                webgl2: canvas.getContext("webgl2") === null,
              };
            }"""
        )
        with self.subTest(contract="WebGL contexts disabled before navigation"):
            self.assertEqual(disabled_contexts, {"webgl": True, "webgl2": True})

        callouts = page.locator("[data-intro-callout]")
        with self.subTest(contract="four fallback callouts"):
            self.assertEqual(callouts.count(), 4)

        intro = page.locator("[data-intro]")
        with self.subTest(contract="fallback intro remains available"):
            self.assertEqual(intro.count(), 1)
        if intro.count() == 1:
            self.scroll_intro_to(page, 0.82)
            with self.subTest(contract="fallback reaches domain phase"):
                self.assertEqual(
                    page.locator("[data-intro-stage]").get_attribute("data-phase"),
                    "domain",
                )
        for index in range(callouts.count()):
            with self.subTest(callout=index + 1, contract="fallback readability"):
                self.assert_element_readable(callouts.nth(index))

        fallback_character = page.locator("[data-intro-stage] img.hero-character")
        character_count = fallback_character.count()
        with self.subTest(contract="one fallback character"):
            self.assertEqual(character_count, 1)
        if character_count == 1:
            with self.subTest(contract="fallback character visible"):
                self.assert_element_readable(fallback_character)

    def test_no_horizontal_overflow(self):
        for width, height in [(1440, 1000), (1024, 900), (820, 900), (390, 844)]:
            with self.subTest(width=width):
                page = self.open_page(width=width, height=height)
                dimensions = page.evaluate(
                    "({inner: window.innerWidth, scroll: document.documentElement.scrollWidth})"
                )
                self.assertLessEqual(dimensions["scroll"], dimensions["inner"] + 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
