document.querySelectorAll(".prose h2, .prose h3").forEach((heading) => {
  if (!heading.id) {
    const slug = heading.textContent.trim().toLocaleLowerCase("zh-CN")
      .replace(/\s+/g, "-")
      .replace(/[^\p{L}\p{N}_-]/gu, "");
    if (slug) heading.id = slug;
  }
});
