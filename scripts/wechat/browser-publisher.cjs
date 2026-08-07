const LABELS = Object.freeze({
  drafts: "草稿箱",
  published: "发表记录",
  publish: "发表",
  withdraw: ["撤回", "删除"],
  confirmPublish: "发表",
  confirmWithdraw: ["确认撤回", "确认删除"],
});

const BLOCKER_LABELS = Object.freeze({
  login: ["请使用微信扫描二维码登录", "请扫描二维码登录", "扫码登录"],
  captcha: ["请完成验证码", "请输入验证码", "安全验证"],
  verification: ["请完成账号验证", "账号验证", "帐号验证", "身份验证"],
});

const BLOCKER_ERRORS = Object.freeze({
  login: "微信登录已失效，请在专用浏览器配置中重新登录。",
  captcha: "微信页面要求完成验证码，已停止所有操作。",
  verification: "微信页面要求账号验证，已停止所有操作。",
});

async function visibleLocators(locator) {
  const visible = [];
  for (let index = 0; index < await locator.count(); index += 1) {
    const item = locator.nth(index);
    if (await item.isVisible()) visible.push(item);
  }
  return visible;
}

async function hasVisibleExactText(page, labels) {
  for (const label of labels) {
    if ((await visibleLocators(page.getByText(label, { exact: true }))).length > 0) {
      return true;
    }
  }
  return false;
}

async function detectGlobalBlocker(page) {
  if (await hasVisibleExactText(page, BLOCKER_LABELS.login)) return { kind: "login" };
  if (await hasVisibleExactText(page, BLOCKER_LABELS.captcha)) return { kind: "captcha" };
  if (await hasVisibleExactText(page, BLOCKER_LABELS.verification)) return { kind: "verification" };
  return null;
}

async function assertNoGlobalBlocker(page) {
  const blocker = await detectGlobalBlocker(page);
  if (blocker) throw new Error(BLOCKER_ERRORS[blocker.kind]);
}

function normalizedUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return String(value);
  }
}

function candidateMetadata(href) {
  const url = new URL(href);
  return {
    sourceUrl: url.searchParams.get("content_source_url")
      || url.searchParams.get("source_url"),
    platformArticleId: url.searchParams.get("appmsgid")
      || url.searchParams.get("appmsg_id")
      || url.searchParams.get("article_id"),
  };
}

function metadataConflicts(post, href) {
  const metadata = candidateMetadata(href);
  return Boolean(
    (post.sourceUrl && metadata.sourceUrl
      && normalizedUrl(post.sourceUrl) !== normalizedUrl(metadata.sourceUrl))
    || (post.platformArticleId && metadata.platformArticleId
      && String(post.platformArticleId) !== metadata.platformArticleId),
  );
}

async function oneVisible(locator, messages) {
  const visible = await visibleLocators(locator);
  if (visible.length === 0) throw new Error(messages.zero);
  if (visible.length > 1) throw new Error(messages.multiple);
  return visible[0];
}

class WechatBrowserAdapter {
  constructor(page) {
    this.page = page;
  }

  async checkSession() {
    const blocker = await detectGlobalBlocker(this.page);
    if (blocker) return { authenticated: false, blocker: blocker.kind };

    const draftLinks = await visibleLocators(
      this.page.getByRole("link", { name: LABELS.drafts, exact: true }),
    );
    const publishedLinks = await visibleLocators(
      this.page.getByRole("link", { name: LABELS.published, exact: true }),
    );
    if (draftLinks.length === 1 && publishedLinks.length === 1) {
      return { authenticated: true };
    }
    throw new Error("无法识别微信公众平台页面，已停止所有操作。");
  }

  async navigateTo(label) {
    await assertNoGlobalBlocker(this.page);
    const link = await oneVisible(
      this.page.getByRole("link", { name: label, exact: true }),
      {
        zero: "未找到预期的微信内容管理入口。",
        multiple: "找到多个微信内容管理入口，已停止操作。",
      },
    );
    if (await link.getAttribute("aria-current") === "page") return;
    await assertNoGlobalBlocker(this.page);
    await link.click();
  }

  async findCandidate(post, type) {
    const isDraft = type === "draft";
    await this.navigateTo(isDraft ? LABELS.drafts : LABELS.published);
    await assertNoGlobalBlocker(this.page);
    const links = await visibleLocators(
      this.page.getByRole("link", { name: post.title, exact: true }),
    );
    if (links.length === 0) {
      throw new Error(isDraft ? "未找到同名草稿。" : "未找到同名已发表文章。");
    }
    if (links.length > 1) {
      throw new Error(isDraft ? "找到多个同名草稿，已停止操作。" : "找到多个同名已发表文章，已停止操作。");
    }

    const rawHref = await links[0].getAttribute("href");
    if (!rawHref) {
      throw new Error(isDraft ? "同名草稿缺少可验证链接。" : "同名已发表文章缺少可验证链接。");
    }
    const href = new URL(rawHref, this.page.url()).href;
    if (metadataConflicts(post, href)) {
      throw new Error(isDraft
        ? "草稿元数据与目标文章冲突，已停止操作。"
        : "已发表文章元数据与目标文章冲突，已停止操作。");
    }
    return { kind: "exact", title: post.title, href };
  }

  async findDraftCandidate(post) {
    return this.findCandidate(post, "draft");
  }

  async findPublishedCandidate(post) {
    return this.findCandidate(post, "published");
  }

  async openCandidate(candidate, type) {
    await assertNoGlobalBlocker(this.page);
    if (!candidate || candidate.kind !== "exact" || !candidate.title || !candidate.href) {
      throw new Error("拒绝打开未经精确验证的微信文章候选项。");
    }
    const titleLinks = await visibleLocators(
      this.page.getByRole("link", { name: candidate.title, exact: true }),
    );
    const matching = [];
    for (const link of titleLinks) {
      const rawHref = await link.getAttribute("href");
      if (rawHref && new URL(rawHref, this.page.url()).href === candidate.href) matching.push(link);
    }
    if (matching.length !== 1) {
      throw new Error(type === "draft"
        ? "无法唯一定位已验证草稿，未打开。"
        : "无法唯一定位已验证发表记录，未打开。");
    }
    await assertNoGlobalBlocker(this.page);
    await matching[0].click();
  }

  async openDraft(candidate) {
    await this.openCandidate(candidate, "draft");
  }

  async openPublished(candidate) {
    await this.openCandidate(candidate, "published");
  }

  async assertCurrentTitle(post, type) {
    const headings = await visibleLocators(
      this.page.getByRole("heading", { name: post.title, exact: true }),
    );
    if (headings.length !== 1) {
      throw new Error(type === "draft"
        ? "当前草稿标题与目标文章不一致，未发表。"
        : "当前发表记录标题与目标文章不一致，未撤回。");
    }
  }

  async clickExpectedConfirmation({ dialog, expected, errorMessage }) {
    const confirm = await visibleLocators(
      dialog.getByRole("button", { name: expected, exact: true }),
    );
    if (confirm.length !== 1) throw new Error(errorMessage);

    const buttons = await visibleLocators(dialog.getByRole("button"));
    const texts = await Promise.all(buttons.map((button) => button.textContent()));
    const unexpected = texts.some((text) => {
      const normalized = String(text || "").trim();
      return normalized !== expected && normalized !== "取消";
    });
    if (unexpected) throw new Error(errorMessage);

    await assertNoGlobalBlocker(this.page);
    await confirm[0].click();
  }

  async publishCurrentDraft(post) {
    await assertNoGlobalBlocker(this.page);
    await this.assertCurrentTitle(post, "draft");
    const publish = await oneVisible(
      this.page.getByRole("button", { name: LABELS.publish, exact: true }),
      {
        zero: "未找到唯一的发表按钮，未发表。",
        multiple: "找到多个发表按钮，未发表。",
      },
    );
    await assertNoGlobalBlocker(this.page);
    await publish.click();

    const dialog = await oneVisible(this.page.getByRole("dialog"), {
      zero: "未出现预期的发布确认对话框，未确认发表。",
      multiple: "出现多个发布确认对话框，未确认发表。",
    });
    await this.clickExpectedConfirmation({
      dialog,
      expected: LABELS.confirmPublish,
      errorMessage: "发布确认文案与预期不符，未确认发表。",
    });
  }

  async verifyPublished(post) {
    const candidate = await this.findPublishedCandidate(post);
    return { published: true, candidate };
  }

  async withdrawCurrentArticle(post) {
    await assertNoGlobalBlocker(this.page);
    await this.assertCurrentTitle(post, "published");
    const actions = [];
    for (const label of LABELS.withdraw) {
      for (const locator of await visibleLocators(
        this.page.getByRole("button", { name: label, exact: true }),
      )) {
        actions.push({ label, locator });
      }
    }
    if (actions.length === 0) throw new Error("未找到唯一的撤回控件，未撤回。");
    if (actions.length > 1) throw new Error("找到多个撤回控件，未撤回。");

    await assertNoGlobalBlocker(this.page);
    await actions[0].locator.click();
    const dialog = await oneVisible(this.page.getByRole("dialog"), {
      zero: "未出现预期的撤回确认对话框，未确认撤回。",
      multiple: "出现多个撤回确认对话框，未确认撤回。",
    });
    const actionIndex = LABELS.withdraw.indexOf(actions[0].label);
    await this.clickExpectedConfirmation({
      dialog,
      expected: LABELS.confirmWithdraw[actionIndex],
      errorMessage: "撤回确认文案与预期不符，未确认撤回。",
    });
  }

  async verifyWithdrawn(post) {
    await this.navigateTo(LABELS.published);
    await assertNoGlobalBlocker(this.page);
    const matches = await visibleLocators(
      this.page.getByRole("link", { name: post.title, exact: true }),
    );
    if (matches.length > 0) {
      throw new Error(matches.length === 1
        ? "同名文章仍在发表记录中，撤回尚未验证。"
        : "发表记录中存在多个同名文章，撤回状态不明确。");
    }
    return { withdrawn: true };
  }
}

module.exports = {
  LABELS,
  WechatBrowserAdapter,
  detectGlobalBlocker,
};
