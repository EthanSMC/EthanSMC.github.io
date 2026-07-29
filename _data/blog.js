const { loadBlog } = require("../scripts/prepare-content.cjs");

module.exports = function () {
  return loadBlog();
};
