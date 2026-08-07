const LABELS = Object.freeze({
  drafts: "草稿箱",
  published: "发表记录",
  publish: "发表",
  withdraw: ["撤回", "删除"],
  confirmPublish: "发表",
  confirmWithdraw: ["确认撤回", "确认删除"],
});

const BROWSER_ERROR_CODES = Object.freeze({
  SESSION_LOGIN_REQUIRED: "WECHAT_SESSION_LOGIN_REQUIRED",
  SESSION_CAPTCHA_REQUIRED: "WECHAT_SESSION_CAPTCHA_REQUIRED",
  SESSION_VERIFICATION_REQUIRED: "WECHAT_SESSION_VERIFICATION_REQUIRED",
  PAGE_UNRECOGNIZED: "WECHAT_PAGE_UNRECOGNIZED",
  NAVIGATION_ENTRY_CHANGED: "WECHAT_NAVIGATION_ENTRY_CHANGED",
  DRAFT_CANDIDATE_NOT_FOUND: "WECHAT_DRAFT_CANDIDATE_NOT_FOUND",
  DRAFT_CANDIDATE_MULTIPLE: "WECHAT_DRAFT_CANDIDATE_MULTIPLE",
  PUBLISHED_CANDIDATE_MULTIPLE: "WECHAT_PUBLISHED_CANDIDATE_MULTIPLE",
  PUBLISHED_LIST_NOT_READY: "WECHAT_PUBLISHED_LIST_NOT_READY",
  PUBLISHED_LIST_NOT_EXHAUSTIVE: "WECHAT_PUBLISHED_LIST_NOT_EXHAUSTIVE",
  CANDIDATE_LINK_MISSING: "WECHAT_CANDIDATE_LINK_MISSING",
  CANDIDATE_IDENTITY_CONFLICT: "WECHAT_CANDIDATE_IDENTITY_CONFLICT",
  CANDIDATE_INPUT_INVALID: "WECHAT_CANDIDATE_INPUT_INVALID",
  CANDIDATE_OPEN_MISMATCH: "WECHAT_CANDIDATE_OPEN_MISMATCH",
  CURRENT_CONTAINER_MISMATCH: "WECHAT_CURRENT_CONTAINER_MISMATCH",
  PUBLISH_CONTROL_CHANGED: "WECHAT_PUBLISH_CONTROL_CHANGED",
  WITHDRAW_CONTROL_CHANGED: "WECHAT_WITHDRAW_CONTROL_CHANGED",
  CONFIRMATION_CHANGED: "WECHAT_CONFIRMATION_CHANGED",
  WITHDRAWAL_STILL_PRESENT: "WECHAT_WITHDRAWAL_STILL_PRESENT",
  WITHDRAWAL_AMBIGUOUS: "WECHAT_WITHDRAWAL_AMBIGUOUS",
});

const RECORD_LOCAL_BROWSER_ERROR_CODES = Object.freeze([
  BROWSER_ERROR_CODES.DRAFT_CANDIDATE_NOT_FOUND,
  BROWSER_ERROR_CODES.DRAFT_CANDIDATE_MULTIPLE,
  BROWSER_ERROR_CODES.PUBLISHED_CANDIDATE_MULTIPLE,
  BROWSER_ERROR_CODES.CANDIDATE_LINK_MISSING,
  BROWSER_ERROR_CODES.CANDIDATE_IDENTITY_CONFLICT,
  BROWSER_ERROR_CODES.CANDIDATE_OPEN_MISMATCH,
  BROWSER_ERROR_CODES.CURRENT_CONTAINER_MISMATCH,
  BROWSER_ERROR_CODES.WITHDRAWAL_STILL_PRESENT,
  BROWSER_ERROR_CODES.WITHDRAWAL_AMBIGUOUS,
]);

function browserError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

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

const CONTAINER_LABELS = Object.freeze({
  draft: "草稿编辑器",
  published: "已发表文章详情",
});

const IDENTITY_LABELS = Object.freeze({
  sourceUrl: "原文链接",
  platformArticleId: "平台文章 ID",
});

const CONFIRMATIONS = Object.freeze({
  publish: Object.freeze({
    prompt: "确认发表这篇文章吗？",
    confirm: LABELS.confirmPublish,
  }),
  withdraw: Object.freeze({
    prompt: "撤回后文章将无法公开访问。",
    confirm: LABELS.confirmWithdraw,
  }),
});

const SOURCE_URL_ALIASES = Object.freeze(["content_source_url", "source_url"]);
const PLATFORM_ID_ALIASES = Object.freeze(["appmsgid", "appmsg_id", "article_id"]);

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
  if (blocker) {
    const codes = {
      login: BROWSER_ERROR_CODES.SESSION_LOGIN_REQUIRED,
      captcha: BROWSER_ERROR_CODES.SESSION_CAPTCHA_REQUIRED,
      verification: BROWSER_ERROR_CODES.SESSION_VERIFICATION_REQUIRED,
    };
    throw browserError(codes[blocker.kind], BLOCKER_ERRORS[blocker.kind]);
  }
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

function collectQueryValues(url, aliases) {
  return aliases.flatMap((alias) => url.searchParams.getAll(alias));
}

function candidateMetadata(href) {
  const url = new URL(href);
  return {
    sourceUrls: collectQueryValues(url, SOURCE_URL_ALIASES),
    platformArticleIds: collectQueryValues(url, PLATFORM_ID_ALIASES),
  };
}

function valuesConflict(expected, values, normalize) {
  if (values.length === 0) return false;
  if (values.some((value) => value === "")) return true;
  const normalizedValues = values.map(normalize);
  if (new Set(normalizedValues).size !== 1) return true;
  return expected ? normalizedValues.some((value) => value !== normalize(expected)) : false;
}

function metadataConflicts(post, href) {
  const metadata = candidateMetadata(href);
  return Boolean(
    valuesConflict(post.sourceUrl, metadata.sourceUrls, normalizedUrl)
    || valuesConflict(
      post.platformArticleId,
      metadata.platformArticleIds,
      (value) => String(value),
    ),
  );
}

async function oneVisible(locator, messages) {
  const visible = await visibleLocators(locator);
  if (visible.length === 0) throw browserError(messages.code, messages.zero);
  if (visible.length > 1) throw browserError(messages.code, messages.multiple);
  return visible[0];
}

class WechatBrowserAdapter {
  constructor(page, options = {}) {
    this.page = page;
    this.publishedListReadiness = options.publishedListReadiness || null;
    this.fetchPublicArticle = options.fetchPublicArticle || (async (url) => {
      const response = await this.page.request.get(url, {
        failOnStatusCode: false,
        maxRedirects: 0,
        timeout: 15_000,
      });
      return { status: response.status() };
    });
  }

  async assertPublishedListReady() {
    if (typeof this.publishedListReadiness !== "function") {
      throw browserError(
        BROWSER_ERROR_CODES.PAGE_UNRECOGNIZED,
        "尚未验收微信发表列表的完整就绪状态，已停止所有操作。",
      );
    }
    let readiness;
    try {
      readiness = await this.publishedListReadiness({ page: this.page });
    } catch {
      throw browserError(
        BROWSER_ERROR_CODES.PAGE_UNRECOGNIZED,
        "无法验证微信发表列表状态，已停止所有操作。",
      );
    }
    if (readiness?.kind === "complete" && Object.keys(readiness).length === 1) return;
    if (readiness?.kind === "loading") {
      throw browserError(
        BROWSER_ERROR_CODES.PUBLISHED_LIST_NOT_READY,
        "微信发表列表仍在加载，已停止所有操作。",
      );
    }
    if (readiness?.kind === "partial" || readiness?.kind === "paginated") {
      throw browserError(
        BROWSER_ERROR_CODES.PUBLISHED_LIST_NOT_EXHAUSTIVE,
        "微信发表列表不是可穷尽结果，已停止所有操作。",
      );
    }
    throw browserError(
      BROWSER_ERROR_CODES.PAGE_UNRECOGNIZED,
      "无法识别微信发表列表的完整就绪状态，已停止所有操作。",
    );
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
    throw browserError(
      BROWSER_ERROR_CODES.PAGE_UNRECOGNIZED,
      "无法识别微信公众平台页面，已停止所有操作。",
    );
  }

  async navigateTo(label) {
    await assertNoGlobalBlocker(this.page);
    const link = await oneVisible(
      this.page.getByRole("link", { name: label, exact: true }),
      {
        code: BROWSER_ERROR_CODES.NAVIGATION_ENTRY_CHANGED,
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
    if (!isDraft) await this.assertPublishedListReady();
    const links = await visibleLocators(
      this.page.getByRole("link", { name: post.title, exact: true }),
    );
    if (links.length === 0) {
      if (!isDraft) return { kind: "absent" };
      throw browserError(
        BROWSER_ERROR_CODES.DRAFT_CANDIDATE_NOT_FOUND,
        "未找到同名草稿。",
      );
    }
    if (links.length > 1) {
      throw browserError(
        isDraft
          ? BROWSER_ERROR_CODES.DRAFT_CANDIDATE_MULTIPLE
          : BROWSER_ERROR_CODES.PUBLISHED_CANDIDATE_MULTIPLE,
        isDraft ? "找到多个同名草稿，已停止操作。" : "找到多个同名已发表文章，已停止操作。",
      );
    }

    const rawHref = await links[0].getAttribute("href");
    if (!rawHref) {
      throw browserError(
        BROWSER_ERROR_CODES.CANDIDATE_LINK_MISSING,
        isDraft ? "同名草稿缺少可验证链接。" : "同名已发表文章缺少可验证链接。",
      );
    }
    const href = new URL(rawHref, this.page.url()).href;
    if (metadataConflicts(post, href)) {
      throw browserError(
        BROWSER_ERROR_CODES.CANDIDATE_IDENTITY_CONFLICT,
        isDraft
          ? "草稿元数据与目标文章冲突，已停止操作。"
          : "已发表文章元数据与目标文章冲突，已停止操作。",
      );
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
      throw browserError(
        BROWSER_ERROR_CODES.CANDIDATE_INPUT_INVALID,
        "拒绝打开未经精确验证的微信文章候选项。",
      );
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
      throw browserError(
        BROWSER_ERROR_CODES.CANDIDATE_OPEN_MISMATCH,
        type === "draft"
          ? "无法唯一定位已验证草稿，未打开。"
          : "无法唯一定位已验证发表记录，未打开。",
      );
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

  async containerMatchesPost(container, post) {
    const headings = await visibleLocators(
      container.getByRole("heading", { name: post.title, exact: true }),
    );
    if (headings.length !== 1) return false;

    const expectedIdentities = [
      ["sourceUrl", post.sourceUrl, normalizedUrl],
      ["platformArticleId", post.platformArticleId, (value) => String(value)],
    ].filter(([, expected]) => expected);
    if (expectedIdentities.length === 0) return false;

    for (const [field, expected, normalize] of expectedIdentities) {
      const controls = await visibleLocators(
        container.getByRole("textbox", { name: IDENTITY_LABELS[field], exact: true }),
      );
      if (controls.length !== 1) return false;
      if (normalize(await controls[0].inputValue()) !== normalize(expected)) return false;
    }
    return true;
  }

  async verifiedCurrentContainer(post, type) {
    const containers = await visibleLocators(
      this.page.getByRole("region", { name: CONTAINER_LABELS[type], exact: true }),
    );
    const matching = [];
    for (const container of containers) {
      if (await this.containerMatchesPost(container, post)) matching.push(container);
    }
    if (matching.length !== 1) {
      throw browserError(
        BROWSER_ERROR_CODES.CURRENT_CONTAINER_MISMATCH,
        type === "draft"
          ? "无法唯一验证当前草稿的标题与身份，未发表。"
          : "无法唯一验证当前发表记录的标题与身份，未撤回。",
      );
    }
    return matching[0];
  }

  async clickExpectedConfirmation({ dialog, expected, prompt, errorMessage }) {
    const confirm = await visibleLocators(
      dialog.getByRole("button", { name: expected, exact: true }),
    );
    const cancel = await visibleLocators(
      dialog.getByRole("button", { name: "取消", exact: true }),
    );

    const buttons = await visibleLocators(dialog.getByRole("button"));
    const texts = await Promise.all(buttons.map((button) => button.textContent()));
    const exactButtons = texts.length === 2
      && confirm.length === 1
      && cancel.length === 1
      && texts.every((text) => [expected, "取消"].includes(String(text || "").trim()));

    const unexpectedControls = [];
    for (const role of ["checkbox", "radio", "textbox", "combobox", "listbox", "link", "switch"]) {
      unexpectedControls.push(...await visibleLocators(dialog.getByRole(role)));
    }
    unexpectedControls.push(...await visibleLocators(dialog.locator("input, select, textarea")));
    const actualText = (await dialog.innerText()).replace(/\s+/g, " ").trim();
    const expectedText = `${prompt} ${expected} 取消`;
    if (!exactButtons || unexpectedControls.length > 0 || actualText !== expectedText) {
      throw browserError(BROWSER_ERROR_CODES.CONFIRMATION_CHANGED, errorMessage);
    }

    await assertNoGlobalBlocker(this.page);
    await confirm[0].click();
  }

  async publishCurrentDraft(post) {
    await assertNoGlobalBlocker(this.page);
    const container = await this.verifiedCurrentContainer(post, "draft");
    const publish = await oneVisible(
      container.getByRole("button", { name: LABELS.publish, exact: true }),
      {
        code: BROWSER_ERROR_CODES.PUBLISH_CONTROL_CHANGED,
        zero: "未找到唯一的发表按钮，未发表。",
        multiple: "找到多个发表按钮，未发表。",
      },
    );
    await assertNoGlobalBlocker(this.page);
    await publish.click();
    await assertNoGlobalBlocker(this.page);

    const dialog = await oneVisible(this.page.getByRole("dialog"), {
      code: BROWSER_ERROR_CODES.CONFIRMATION_CHANGED,
      zero: "未出现预期的发布确认对话框，未确认发表。",
      multiple: "出现多个发布确认对话框，未确认发表。",
    });
    await this.clickExpectedConfirmation({
      dialog,
      expected: CONFIRMATIONS.publish.confirm,
      prompt: CONFIRMATIONS.publish.prompt,
      errorMessage: "发布确认内容与预期不符，未确认发表。",
    });
  }

  async verifyPublished(post) {
    const candidate = await this.findPublishedCandidate(post);
    return { published: true, candidate };
  }

  async withdrawCurrentArticle(post) {
    await assertNoGlobalBlocker(this.page);
    const container = await this.verifiedCurrentContainer(post, "published");
    const actions = [];
    for (const label of LABELS.withdraw) {
      for (const locator of await visibleLocators(
        container.getByRole("button", { name: label, exact: true }),
      )) {
        actions.push({ label, locator });
      }
    }
    if (actions.length === 0) {
      throw browserError(
        BROWSER_ERROR_CODES.WITHDRAW_CONTROL_CHANGED,
        "未找到唯一的撤回控件，未撤回。",
      );
    }
    if (actions.length > 1) {
      throw browserError(
        BROWSER_ERROR_CODES.WITHDRAW_CONTROL_CHANGED,
        "找到多个撤回控件，未撤回。",
      );
    }

    await assertNoGlobalBlocker(this.page);
    await actions[0].locator.click();
    await assertNoGlobalBlocker(this.page);
    const dialog = await oneVisible(this.page.getByRole("dialog"), {
      code: BROWSER_ERROR_CODES.CONFIRMATION_CHANGED,
      zero: "未出现预期的撤回确认对话框，未确认撤回。",
      multiple: "出现多个撤回确认对话框，未确认撤回。",
    });
    const actionIndex = LABELS.withdraw.indexOf(actions[0].label);
    await this.clickExpectedConfirmation({
      dialog,
      expected: CONFIRMATIONS.withdraw.confirm[actionIndex],
      prompt: CONFIRMATIONS.withdraw.prompt,
      errorMessage: "撤回确认内容与预期不符，未确认撤回。",
    });
  }

  async verifyWithdrawn(post) {
    const result = await this.findPublishedCandidate(post);
    if (result.kind !== "absent") {
      throw browserError(
        BROWSER_ERROR_CODES.WITHDRAWAL_STILL_PRESENT,
        "文章仍在发表记录中，撤回尚未验证。",
      );
    }
    let publishedUrl;
    let hasPublishedUrl;
    if (Object.hasOwn(post, "publication")) {
      if (
        !post.publication
        || typeof post.publication !== "object"
        || Array.isArray(post.publication)
      ) {
        throw browserError(
          BROWSER_ERROR_CODES.WITHDRAWAL_AMBIGUOUS,
          "已保存的公开文章状态无效，撤回状态不明确。",
        );
      }
      hasPublishedUrl = Object.hasOwn(post.publication, "publishedUrl");
      publishedUrl = post.publication.publishedUrl;
    } else {
      hasPublishedUrl = Object.hasOwn(post, "publishedUrl");
      publishedUrl = post.publishedUrl;
    }
    if (hasPublishedUrl && publishedUrl !== null) {
      let publicUrl;
      try {
        publicUrl = new URL(publishedUrl);
      } catch {
        throw browserError(
          BROWSER_ERROR_CODES.WITHDRAWAL_AMBIGUOUS,
          "已保存的公开文章链接无效，撤回状态不明确。",
        );
      }
      if (
        publicUrl.protocol !== "https:"
        || publicUrl.host !== "mp.weixin.qq.com"
        || publicUrl.username
        || publicUrl.password
        || !/^\/s(?:\/.*)?$/.test(publicUrl.pathname)
      ) {
        throw browserError(
          BROWSER_ERROR_CODES.WITHDRAWAL_AMBIGUOUS,
          "已保存的公开文章链接无效，撤回状态不明确。",
        );
      }

      let response;
      try {
        response = await this.fetchPublicArticle(publicUrl.href);
      } catch {
        throw browserError(
          BROWSER_ERROR_CODES.WITHDRAWAL_AMBIGUOUS,
          "公开文章链接响应不明确，撤回尚未验证。",
        );
      }
      if (!response || !Number.isInteger(response.status)) {
        throw browserError(
          BROWSER_ERROR_CODES.WITHDRAWAL_AMBIGUOUS,
          "公开文章链接响应不明确，撤回尚未验证。",
        );
      }
      if (response.status !== 404 && response.status !== 410) {
        throw browserError(
          response.status >= 200 && response.status < 300
            ? BROWSER_ERROR_CODES.WITHDRAWAL_STILL_PRESENT
            : BROWSER_ERROR_CODES.WITHDRAWAL_AMBIGUOUS,
          response.status >= 200 && response.status < 300
            ? "公开文章链接仍可读取，撤回尚未验证。"
            : "公开文章链接响应不明确，撤回尚未验证。",
        );
      }
    }
    return { withdrawn: true };
  }
}

module.exports = {
  BROWSER_ERROR_CODES,
  LABELS,
  RECORD_LOCAL_BROWSER_ERROR_CODES,
  WechatBrowserAdapter,
  browserError,
  detectGlobalBlocker,
};
