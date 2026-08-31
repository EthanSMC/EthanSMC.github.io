const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assignHeadingIds,
  calculateReadingProgress,
  shouldEnableContents,
  slugifyHeading,
} = require("../reading-navigation.js");

test("creates stable, readable heading slugs", () => {
  assert.equal(slugifyHeading("Why：为什么值得自己做？"), "why-为什么值得自己做");
  assert.equal(slugifyHeading("  Build   With_Care  "), "build-with_care");
  assert.equal(slugifyHeading("？！"), "section");
});

test("assigns unique heading ids while preserving authored ids", () => {
  const headings = [
    { textContent: "重复", id: "" },
    { textContent: "重复", id: "" },
    { textContent: "Custom", id: "custom" },
    { textContent: "Custom", id: "" },
  ];

  assert.deepEqual(
    assignHeadingIds(headings).map((heading) => heading.id),
    ["重复", "重复-2", "custom", "custom-2"],
  );
});

test("enables full navigation only for structurally long reads", () => {
  assert.equal(shouldEnableContents({ headingCount: 3, readingMinutes: 2 }), true);
  assert.equal(shouldEnableContents({ headingCount: 0, readingMinutes: 5 }), true);
  assert.equal(shouldEnableContents({ headingCount: 1, readingMinutes: 2 }), false);
});

test("calculates clamped reading progress without invalid numbers", () => {
  const dimensions = {
    bodyStart: 100,
    bodyEnd: 1100,
    viewportHeight: 400,
    toolbarOffset: 100,
  };

  assert.equal(calculateReadingProgress({ ...dimensions, scrollY: 350 }), 0.5);
  assert.equal(calculateReadingProgress({ ...dimensions, scrollY: -100 }), 0);
  assert.equal(calculateReadingProgress({ ...dimensions, scrollY: 900 }), 1);
  assert.equal(calculateReadingProgress({
    scrollY: 0,
    bodyStart: 0,
    bodyEnd: 200,
    viewportHeight: 800,
    toolbarOffset: 80,
  }), 1);
});
