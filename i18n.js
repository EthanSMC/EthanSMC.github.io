const SUPPORTED_LOCALES = Object.freeze(["zh", "ja", "en"]);
const HTML_LANGS = Object.freeze({ zh: "zh-CN", ja: "ja-JP", en: "en" });
const EXPLICIT_LOCALE_KEY = "ethansmc.locale";
const IP_LOCALE_KEY = "ethansmc.ip-locale";

const messages = {
  zh: {
    "meta.home.title": "是 Ethan，不是埃森｜碎碎念版",
    "meta.home.description": "这里没有标准答案。让思考发生，让讨论继续。",
    "meta.blog.title": "写作｜申名翀 Ethan",
    "meta.blog.description": "产品现场、AI 实验和一些暂时没有答案的问题——趁它们还热，先写下来。",
    "meta.writingBy": "Ethan 的写作",
    "common.skip": "跳到主要内容",
    "common.primaryNavigation": "主导航",
    "common.languageSwitcher": "切换语言",
    "common.homeAria": "是 Ethan 不是埃森首页",
    "common.sayHi": "打个招呼",
    "common.openWechat": "打开 Ethan 的微信二维码",
    "common.closeWechat": "关闭微信二维码",
    "common.enableSounds": "开启界面音效",
    "common.disableSounds": "关闭界面音效",
    "nav.about": "关于",
    "nav.projects": "项目",
    "nav.writing": "写作",
    "nav.contact": "联系",
    "home.canvasAria": "手绘数字 Ethan 互动场景",
    "home.hero.nameTop": "是 Ethan",
    "home.hero.nameBottom": "不是埃森",
    "home.hero.tagline": "金融科技产品经理 × AI Agent 构建者",
    "home.calloutsAria": "关于 Ethan",
    "home.identity.location": "中国上海",
    "home.role.title": "金融科技产品经理",
    "home.role.body": "财富与资产管理工作流",
    "home.education.title": "教育经历",
    "home.education.degree": "圣路易斯华盛顿大学",
    "home.education.detail": "金融学硕士，资产管理方向 · GPA 3.95 / 4.0 · Beta Gamma Sigma",
    "home.education.coursework": "衍生品 · 随机过程 · 风险管理 · 固定收益 · Python · SQL",
    "home.domain.title": "专业领域",
    "home.domain.body": "债券 · 交易 · 风控",
    "home.builder.title": "AI 构建者",
    "home.builder.body": "Agent 辅助系统",
    "home.characterAlt": "手绘数字 Ethan 手持 MacBook 站立",
    "home.scroll": "向下滚动",
    "home.scrollAria": "滚动到写作",
    "experience.title": "工作经历",
    "experience.description": "从债券与资管业务出发，把复杂判断做成真正可用的产品与 AI 工作流。",
    "experience.now": "2025.12 — 至今",
    "experience.one.title": "上海国智技术有限公司 · AI 产品经理",
    "experience.one.body1": "负责全资产资管平台客户端产品设计，覆盖投研、交易、风控链路；构建多场景工作台，让用户在一个页面完成从簿记到风控测算的交易生命周期操作。",
    "experience.one.body2": "推进“AI + 资管”中试基地 Agent 场景和产品经理 Agent 设计，将业务探查、信息收集、数据依赖和产品判断拆成可复用流程。",
    "experience.two.title": "同花顺 iFinD · AI 债券产品经理",
    "experience.two.body": "负责债券经纪商行情筛选 Agent，让用户通过自然语言完成多维度债券筛选和过滤；参与 Chat 后端与问财 AI 对接测试、竞品效果对比和评分标注。",
    "experience.three.title": "上海森浦信息服务有限公司 · 产品经理",
    "experience.three.body": "设计债券信用分析、成交偏离监控、信用债曲线定价和自动化场外交易产品。金融 Q 使用 NLP + LLM 标准化投资经理、交易员、做市商和 Broker 之间的指令流转，将报价触发从约 1 分钟压缩到 1 秒，将成交单梳理从约 30 分钟缩短到 2 分钟。",
    "projects.title": "精选项目",
    "projects.description": "从真实业务问题出发，把金融判断、Agent 能力和产品方法做成可以被使用的工具。",
    "projects.previous": "上一个项目",
    "projects.next": "下一个项目",
    "projects.one.title": "AI 原生财富与资产管理系统",
    "projects.one.body": "覆盖投研、交易与风控流程的 AI 原生财富与资产管理工作台。",
    "projects.one.tag1": "金融科技 PM",
    "projects.one.tag2": "工作流",
    "projects.one.tag3": "风控",
    "projects.two.title": "债券 Agent 与金融 Q",
    "projects.two.body": "使用自然语言、NLP 与 LLM 辅助工作流完成债券筛选和场外交易自动化。",
    "projects.two.tag1": "债券",
    "projects.two.tag2": "大模型",
    "projects.two.tag3": "报价流",
    "projects.three.body": "由 Writer、Editor、Archiver 和 Option Generator 等角色协作的多 Agent 互动小说产品。",
    "projects.three.tag1": "多 Agent",
    "projects.three.tag2": "记忆",
    "projects.three.tag3": "构建工具",
    "projects.openSite": "打开网站",
    "projects.openSiteAria": "在新标签页打开 Novelty Studio",
    "writing.title": "写作",
    "writing.description": "产品现场、AI 实验和一些暂时没有答案的问题——趁它们还热，先写下来。",
    "writing.viewAll": "查看全部写作",
    "writing.albums": "专辑",
    "writing.independent": "独立文章",
    "writing.smallTalks": "碎碎念",
    "writing.albumPrevious": "上一本专辑",
    "writing.albumNext": "下一本专辑",
    "writing.albumStatus": "第 {current} 本，共 {total} 本：{title}",
    "writing.albumsEmpty": "专辑正在装订中。",
    "writing.albumTracksEmpty": "文章正在装订中。",
    "writing.independentEmpty": "独立文章还在纸上。",
    "writing.smallTalksEmpty": "碎碎念还没落到纸上。",
    "writing.latestEssay": "最新文章",
    "writing.readMore": "阅读全文",
    "writing.enter": "进入写作",
    "writing.emptyTitle": "第一篇还在纸上。",
    "writing.emptyBody": "从 Obsidian 发布后，最新的长文和随记会自动出现在这里。",
    "repos.title": "精选代码仓库",
    "repos.description": "公开仓库是我的实验室：把产品方法、Agent 能力和个人 IP 系统沉淀成可复用资产。",
    "repos.viewAll": "查看全部仓库",
    "repos.digitalMe": "把照片或文字描述转化为个人 IP 系统的可复用工作流。",
    "repos.pmSkills": "产品经理技能库与实战方法论，把需求分析、竞品研究和复盘沉淀为结构化能力。",
    "repos.mcdSkill": "麦当劳点餐助手，支持 OpenClaw、Claude Code 等 Agent 框架的实用技能。",
    "repos.learnBack": "从基础到项目实践的后端学习路线与项目库，记录系统学习的回路。",
    "contributions.title": "365 天持续创造",
    "contributions.loading": "正在加载贡献记录",
    "contributions.calendarAria": "GitHub 贡献日历",
    "contributions.viewProfile": "查看 GitHub 主页",
    "contributions.singular": "次贡献",
    "contributions.plural": "次贡献",
    "contributions.total": "{count} 次贡献",
    "contributions.grid": "{username} 从 {from} 至 {to} 的 GitHub 贡献：共 {count} 次",
    "contributions.day": "{date}：{count} 次贡献",
    "contributions.activity": "GitHub 活动",
    "contributions.unavailable": "贡献数据暂时不可用",
    "now.title": "近况",
    "now.description": "最近的重心是把“会做一次”的东西收敛成“可以复用很多次”的工作流。",
    "now.one.title": "构建 AI 资产管理工作流",
    "now.one.body": "把投研、交易和风控中的业务规则、决策判断与协同流程，沉淀为 Agent 可执行、可复用的工作流。",
    "now.two.title": "发布个人 IP 系统",
    "now.two.body": "构建 Digital Ethan 与内容知识库，让个人 IP 和产品叙事能够持续扩展。",
    "now.three.title": "维护产品经理技能库",
    "now.three.body": "把需求分析、竞品研究、PRD 写作和评审沉淀为可复用的产品经理技能栈。",
    "now.four.title": "与 Agent 一起构建",
    "now.four.body": "用 AI 编程工具完成 Novelty Studio 等产品原型，把产品设计和实现连接起来。",
    "now.jul1": "7 月 1 日",
    "now.jun14": "6 月 14 日",
    "daily.title": "每日",
    "daily.ship": "小步发布",
    "daily.document": "认真记录",
    "daily.help": "帮助他人",
    "contact.title": "一起把有用的东西做出来。",
    "contact.body": "欢迎与我合作金融科技产品、AI Agent 工作流、个人 IP 系统，以及把复杂判断转化为可复用系统的产品工具。",
    "contact.email": "邮箱",
    "contact.github": "GitHub",
    "contact.location": "所在地",
    "contact.locationValue": "中国上海",
    "footer.designCredit": "交互参考：",
    "footer.backTop": "返回顶部 ↑",
    "dialog.kicker": "// 打个招呼",
    "dialog.title": "微信",
    "dialog.alt": "Ethan 的微信二维码",
    "dialog.note": "扫码添加我，备注“个人网站”即可。",
    "blog.hero.kicker": "现场笔记 · ETHAN SMC",
    "blog.legendAria": "写作类型说明",
    "blog.essayLegend": "长文 · 展开的判断",
    "blog.noteLegend": "随记 · 当下的片段",
    "blog.filterAria": "按标签筛选文章",
    "blog.all": "全部",
    "blog.timelineAria": "写作时间线",
    "blog.essay": "长文",
    "blog.note": "随记",
    "blog.readMinutes": "{count} 分钟阅读",
    "blog.tagsAria": "标签",
    "blog.pagesAria": "文章分页",
    "blog.newer": "← 更新的记录",
    "blog.older": "更早的记录 →",
    "blog.emptyTitle": "第一篇还在纸上。",
    "blog.emptyBody": "文章发布后，会自动出现在这条时间线上。",
    "blog.post.originalNotice": "本文原文为中文，当前显示为原文；站点界面已切换为中文。",
    "blog.post.navigationAria": "相邻文章",
    "blog.post.previous": "上一篇",
    "blog.post.next": "下一篇",
    "blog.post.back": "返回写作",
    "blog.tag.kicker": "主题索引",
    "blog.tag.back": "← 全部文章",
    "blog.tag.count": "共 {count} 篇记录，按时间倒序排列。",
    "blog.footer.motto": "写下正在形成的判断，也保留暂时没有答案的问题。",
    "error.metaTitle": "页面未找到｜EthanSMC",
    "error.heading": "这一页还没有写下来。",
    "error.body": "地址可能已经变化，或者内容尚未发布。",
    "error.back": "返回首页",
  },
  ja: {
    "meta.home.title": "Ethanです、エッセンではありません｜ひとりごと編",
    "meta.home.description": "ここに正解はありません。考えるきっかけをつくり、対話を続けよう。",
    "meta.blog.title": "文章｜申名翀 Ethan",
    "meta.blog.description": "プロダクトの現場、AIの実験、まだ答えのない問い。熱が冷めないうちに書き留めます。",
    "meta.writingBy": "Ethan の文章",
    "common.skip": "メインコンテンツへ移動",
    "common.primaryNavigation": "メインナビゲーション",
    "common.languageSwitcher": "言語を切り替える",
    "common.homeAria": "Ethan ホーム",
    "common.sayHi": "連絡する",
    "common.openWechat": "Ethan のWeChat QRコードを開く",
    "common.closeWechat": "WeChat QRコードを閉じる",
    "common.enableSounds": "操作音をオンにする",
    "common.disableSounds": "操作音をオフにする",
    "nav.about": "プロフィール",
    "nav.projects": "プロジェクト",
    "nav.writing": "文章",
    "nav.contact": "連絡先",
    "home.canvasAria": "手描きのDigital Ethanインタラクティブシーン",
    "home.hero.nameTop": "Ethanです",
    "home.hero.nameBottom": "エッセンではありません",
    "home.hero.tagline": "フィンテックPM × AIエージェント・ビルダー",
    "home.calloutsAria": "Ethanについて",
    "home.identity.location": "中国・上海",
    "home.role.title": "フィンテック・プロダクトマネージャー",
    "home.role.body": "ウェルス・資産運用ワークフロー",
    "home.education.title": "学歴",
    "home.education.degree": "ワシントン大学セントルイス校",
    "home.education.detail": "金融学修士（資産運用）· GPA 3.95 / 4.0 · Beta Gamma Sigma",
    "home.education.coursework": "デリバティブ · 確率過程 · リスク管理 · 債券 · Python · SQL",
    "home.domain.title": "専門領域",
    "home.domain.body": "債券 · トレーディング · リスク管理",
    "home.builder.title": "AIビルダー",
    "home.builder.body": "エージェント支援システム",
    "home.characterAlt": "MacBookを持って立つ手描きのDigital Ethan",
    "home.scroll": "スクロール",
    "home.scrollAria": "文章までスクロール",
    "experience.title": "職歴",
    "experience.description": "債券・資産運用の現場から、複雑な判断を実際に使えるプロダクトとAIワークフローに変えています。",
    "experience.now": "2025.12 — 現在",
    "experience.one.title": "上海国智技術有限公司 · AIプロダクトマネージャー",
    "experience.one.body1": "全資産運用プラットフォームのクライアント製品を設計し、リサーチ、取引、リスク管理を横断。複数の業務ワークスペースを構築し、ブック記録からリスク計算までを一画面で完結できるようにしました。",
    "experience.one.body2": "「AI × 資産運用」実証拠点のエージェントシナリオとPMエージェントを設計し、業務探索、情報収集、データ依存関係、製品判断を再利用可能なフローに分解しています。",
    "experience.two.title": "同花順 iFinD · AI債券プロダクトマネージャー",
    "experience.two.body": "自然言語で多条件の債券を絞り込めるブローカー向け市場スクリーニング・エージェントを担当。Chatバックエンドと問財AIの連携テスト、競合比較、評価ラベリングにも参加しました。",
    "experience.three.title": "上海森浦信息服務有限公司 · プロダクトマネージャー",
    "experience.three.body": "債券信用分析、約定乖離監視、クレジットカーブ評価、店頭取引自動化を設計。金融QではNLPとLLMで運用担当者、トレーダー、マーケットメーカー、ブローカー間の指示を標準化し、気配値の起動を約1分から1秒、約定整理を約30分から2分へ短縮しました。",
    "projects.title": "主なプロジェクト",
    "projects.description": "実際の業務課題から出発し、金融判断、エージェント機能、プロダクト手法を使える道具にします。",
    "projects.previous": "前のプロジェクト",
    "projects.next": "次のプロジェクト",
    "projects.one.title": "AIネイティブなウェルス・資産運用システム",
    "projects.one.body": "リサーチ、取引、リスク管理を横断するAIネイティブなウェルス・資産運用ワークスペース。",
    "projects.one.tag1": "フィンテックPM",
    "projects.one.tag2": "ワークフロー",
    "projects.one.tag3": "リスク",
    "projects.two.title": "債券エージェント & 金融Q",
    "projects.two.body": "自然言語、NLP、LLM支援ワークフローによる債券スクリーニングと店頭取引の自動化。",
    "projects.two.tag1": "債券",
    "projects.two.tag2": "LLM",
    "projects.two.tag3": "気配値フロー",
    "projects.three.body": "Writer、Editor、Archiver、Option Generatorが協働するマルチエージェント型インタラクティブ小説。",
    "projects.three.tag1": "マルチエージェント",
    "projects.three.tag2": "メモリ",
    "projects.three.tag3": "ビルダー",
    "projects.openSite": "サイトを開く",
    "projects.openSiteAria": "Novelty Studioを新しいタブで開く",
    "writing.title": "文章",
    "writing.description": "プロダクトの現場、AIの実験、まだ答えのない問い。熱が冷めないうちに書き留めます。",
    "writing.viewAll": "すべての文章を見る",
    "writing.albums": "アルバム",
    "writing.independent": "独立した文章",
    "writing.smallTalks": "ひとりごと",
    "writing.albumPrevious": "前のアルバム",
    "writing.albumNext": "次のアルバム",
    "writing.albumStatus": "全{total}冊中{current}冊目：{title}",
    "writing.albumsEmpty": "アルバムを製本中です。",
    "writing.albumTracksEmpty": "文章を綴じています。",
    "writing.independentEmpty": "独立した文章はまだ紙の上です。",
    "writing.smallTalksEmpty": "ひとりごとはまだ紙に落ちていません。",
    "writing.latestEssay": "最新の記事",
    "writing.readMore": "全文を読む",
    "writing.enter": "文章を読む",
    "writing.emptyTitle": "最初の一篇は、まだ紙の上。",
    "writing.emptyBody": "Obsidianから公開すると、最新の長文とノートがここに表示されます。",
    "repos.title": "注目のリポジトリ",
    "repos.description": "公開リポジトリは私の実験室です。プロダクト手法、エージェント機能、個人IPシステムを再利用可能な資産にします。",
    "repos.viewAll": "すべてのリポジトリを見る",
    "repos.digitalMe": "写真や文章から個人IPシステムを作るための再利用可能なワークフロー。",
    "repos.pmSkills": "要件分析、競合調査、振り返りを構造化したPMスキルと実践知。",
    "repos.mcdSkill": "OpenClawやClaude Codeなどのエージェント環境で使えるマクドナルド注文アシスタント。",
    "repos.learnBack": "基礎から実践プロジェクトまで、体系的な学習を記録するバックエンド学習ロードマップ。",
    "contributions.title": "365日、作り続ける",
    "contributions.loading": "コントリビューションを読み込み中",
    "contributions.calendarAria": "GitHubコントリビューションカレンダー",
    "contributions.viewProfile": "GitHubプロフィールを見る",
    "contributions.singular": "件のコントリビューション",
    "contributions.plural": "件のコントリビューション",
    "contributions.total": "{count}件のコントリビューション",
    "contributions.grid": "{username}のGitHubコントリビューション（{from}〜{to}）：合計{count}件",
    "contributions.day": "{date}：{count}件のコントリビューション",
    "contributions.activity": "GitHubアクティビティ",
    "contributions.unavailable": "コントリビューションデータは現在利用できません",
    "now.title": "現在",
    "now.description": "一度だけできることを、何度も再利用できるワークフローへまとめています。",
    "now.one.title": "AI資産運用ワークフローの構築",
    "now.one.body": "リサーチ、取引、リスク管理のルール、判断、協働プロセスを、エージェントが実行・再利用できるワークフローにします。",
    "now.two.title": "個人IPシステムの公開",
    "now.two.body": "Digital Ethanとコンテンツ知識ベースを構築し、個人IPとプロダクトストーリーを拡張できるようにします。",
    "now.three.title": "PMスキルの整備",
    "now.three.body": "要件分析、競合調査、PRD作成、レビューを再利用可能なPMスキルスタックにします。",
    "now.four.title": "エージェントと一緒に作る",
    "now.four.body": "AIコーディングツールでNovelty Studioなどを実装し、プロダクト設計と開発をつなぎます。",
    "now.jul1": "7月1日",
    "now.jun14": "6月14日",
    "daily.title": "日々",
    "daily.ship": "小さく届ける",
    "daily.document": "丁寧に記録する",
    "daily.help": "人を助ける",
    "contact.title": "役に立つものを、一緒に作りましょう。",
    "contact.body": "フィンテック製品、AIエージェントのワークフロー、個人IPシステム、複雑な判断を再現可能な仕組みに変えるプロダクトで協働できます。",
    "contact.email": "メール",
    "contact.github": "GitHub",
    "contact.location": "所在地",
    "contact.locationValue": "中国・上海",
    "footer.designCredit": "インタラクション参考：",
    "footer.backTop": "ページ上部へ ↑",
    "dialog.kicker": "// 連絡する",
    "dialog.title": "WeChat · 微信",
    "dialog.alt": "EthanのWeChat QRコード",
    "dialog.note": "QRコードを読み取り、「個人サイト」と添えてください。",
    "blog.hero.kicker": "フィールドノート · ETHAN SMC",
    "blog.legendAria": "文章タイプの説明",
    "blog.essayLegend": "エッセイ · 展開した判断",
    "blog.noteLegend": "ノート · 今の断片",
    "blog.filterAria": "タグで記事を絞り込む",
    "blog.all": "すべて",
    "blog.timelineAria": "文章タイムライン",
    "blog.essay": "エッセイ",
    "blog.note": "ノート",
    "blog.readMinutes": "読了{count}分",
    "blog.tagsAria": "タグ",
    "blog.pagesAria": "記事ページ",
    "blog.newer": "← 新しい記録",
    "blog.older": "以前の記録 →",
    "blog.emptyTitle": "最初の一篇は、まだ紙の上。",
    "blog.emptyBody": "公開した記事は、このタイムラインに自動で表示されます。",
    "blog.post.originalNotice": "この記事の本文は中国語の原文です。サイトの操作表示は日本語に切り替わっています。",
    "blog.post.navigationAria": "前後の記事",
    "blog.post.previous": "前の記事",
    "blog.post.next": "次の記事",
    "blog.post.back": "文章一覧へ戻る",
    "blog.tag.kicker": "テーマ索引",
    "blog.tag.back": "← すべての記事",
    "blog.tag.count": "{count}件の記録を新しい順に表示しています。",
    "blog.footer.motto": "形になりつつある判断を書き、まだ答えのない問いも残します。",
    "error.metaTitle": "ページが見つかりません｜EthanSMC",
    "error.heading": "このページは、まだ書かれていません。",
    "error.body": "URLが変わったか、コンテンツがまだ公開されていない可能性があります。",
    "error.back": "ホームへ戻る",
  },
  en: {
    "meta.home.title": "It’s Ethan, Not Eason | Ramblings Edition",
    "meta.home.description": "There are no standard answers here. Let ideas take shape, and keep the conversation going.",
    "meta.blog.title": "Writing | Ethan Shen",
    "meta.blog.description": "Field notes from product work, AI experiments, and questions without neat answers—written down while they’re still warm.",
    "meta.writingBy": "Writing by Ethan",
    "common.skip": "Skip to main content",
    "common.primaryNavigation": "Primary navigation",
    "common.languageSwitcher": "Choose language",
    "common.homeAria": "Ethan Shen home",
    "common.sayHi": "Say hi",
    "common.openWechat": "Open Ethan's WeChat QR code",
    "common.closeWechat": "Close WeChat QR code",
    "common.enableSounds": "Enable interface sounds",
    "common.disableSounds": "Disable interface sounds",
    "nav.about": "About",
    "nav.projects": "Projects",
    "nav.writing": "Writing",
    "nav.contact": "Contact",
    "home.canvasAria": "Interactive hand-drawn Digital Ethan scene",
    "home.hero.nameTop": "It’s Ethan",
    "home.hero.nameBottom": "Not Eason",
    "home.hero.tagline": "Fintech Product Manager × AI Agent Builder",
    "home.calloutsAria": "About Ethan",
    "home.identity.location": "Shanghai, China",
    "home.role.title": "Fintech Product Manager",
    "home.role.body": "Wealth and asset-management workflows",
    "home.education.title": "Education",
    "home.education.degree": "Washington University in St. Louis",
    "home.education.detail": "M.S. in Finance, Asset Management · GPA 3.95 / 4.0 · Beta Gamma Sigma",
    "home.education.coursework": "Derivatives · Stochastic processes · Risk management · Fixed income · Python · SQL",
    "home.domain.title": "Domain",
    "home.domain.body": "Bonds · Trading · Risk",
    "home.builder.title": "AI Builder",
    "home.builder.body": "Agent-assisted systems",
    "home.characterAlt": "Hand-drawn Digital Ethan standing with a MacBook",
    "home.scroll": "Scroll",
    "home.scrollAria": "Scroll to writing",
    "experience.title": "Experience",
    "experience.description": "I turn complex judgment from bond and asset-management work into products and AI workflows people can actually use.",
    "experience.now": "2025.12 — Now",
    "experience.one.title": "Shanghai Guozhi Technology · AI Product Manager",
    "experience.one.body1": "Designing the client experience for a multi-asset management platform across research, trading, and risk. I build multi-scenario workspaces that take users from book building to risk calculations on one screen.",
    "experience.one.body2": "Leading agent scenarios and a product-manager agent for an AI + asset-management pilot, turning business discovery, information gathering, data dependencies, and product judgment into reusable workflows.",
    "experience.two.title": "Hithink iFinD · AI Bond Product Manager",
    "experience.two.body": "Built a broker market-screening agent for multi-dimensional bond filtering in natural language, and contributed to Chat integration testing, competitive evaluation, and response scoring for the WenCai AI platform.",
    "experience.three.title": "Shanghai Sumscope Information · Product Manager",
    "experience.three.body": "Designed bond credit analysis, trade-deviation monitoring, credit-curve pricing, and automated OTC trading products. Financial Q used NLP and LLMs to standardize instructions across portfolio managers, traders, market makers, and brokers—cutting quote activation from about one minute to one second and trade-ticket reconciliation from about 30 minutes to two.",
    "projects.title": "Featured Projects",
    "projects.description": "I start with real business problems and turn financial judgment, agent capabilities, and product methods into usable tools.",
    "projects.previous": "Previous project",
    "projects.next": "Next project",
    "projects.one.title": "AI-native Wealth & Asset Management System",
    "projects.one.body": "An AI-native wealth and asset-management workspace spanning research, trading, and risk workflows.",
    "projects.one.tag1": "Fintech PM",
    "projects.one.tag2": "Workflow",
    "projects.one.tag3": "Risk",
    "projects.two.title": "Bond Agent & Financial Q",
    "projects.two.body": "Natural-language bond screening and OTC trading automation using NLP and LLM-assisted workflows.",
    "projects.two.tag1": "Bonds",
    "projects.two.tag2": "LLM",
    "projects.two.tag3": "Quote flow",
    "projects.three.body": "Multi-agent interactive fiction with Writer, Editor, Archiver, and Option Generator roles.",
    "projects.three.tag1": "Multi-agent",
    "projects.three.tag2": "Memory",
    "projects.three.tag3": "Builder",
    "projects.openSite": "Open site",
    "projects.openSiteAria": "Open Novelty Studio in a new tab",
    "writing.title": "Writing",
    "writing.description": "Field notes from product work, AI experiments, and questions without neat answers—written down while they’re still warm.",
    "writing.viewAll": "View all writing",
    "writing.albums": "Albums",
    "writing.independent": "Independent writing",
    "writing.smallTalks": "Small Talks",
    "writing.albumPrevious": "Previous album",
    "writing.albumNext": "Next album",
    "writing.albumStatus": "Album {current} of {total}: {title}",
    "writing.albumsEmpty": "Albums are being bound.",
    "writing.albumTracksEmpty": "Writing is being bound.",
    "writing.independentEmpty": "Independent writing is still on paper.",
    "writing.smallTalksEmpty": "Small Talks have not landed on paper yet.",
    "writing.latestEssay": "Latest essay",
    "writing.readMore": "Read the essay",
    "writing.enter": "Enter Writing",
    "writing.emptyTitle": "The first piece is still on paper.",
    "writing.emptyBody": "New essays and notes will appear here after they are published from Obsidian.",
    "repos.title": "Featured Repositories",
    "repos.description": "My public repositories are a working lab where product methods, agent capabilities, and personal-IP systems become reusable assets.",
    "repos.viewAll": "View all repos",
    "repos.digitalMe": "A reusable workflow for turning photos or descriptions into personal-IP systems.",
    "repos.pmSkills": "A practical PM skill library that turns requirements analysis, competitive research, and retrospectives into structured capabilities.",
    "repos.mcdSkill": "A practical McDonald’s ordering assistant for agent frameworks such as OpenClaw and Claude Code.",
    "repos.learnBack": "A backend learning path and project library, from fundamentals to hands-on systems work.",
    "contributions.title": "365 days of making",
    "contributions.loading": "Loading contributions",
    "contributions.calendarAria": "GitHub contribution calendar",
    "contributions.viewProfile": "View GitHub profile",
    "contributions.singular": "contribution",
    "contributions.plural": "contributions",
    "contributions.total": "{count} contributions",
    "contributions.grid": "{username} GitHub contributions from {from} to {to}: {count} total",
    "contributions.day": "{date}: {count} {unit}",
    "contributions.activity": "GitHub activity",
    "contributions.unavailable": "Contribution data is temporarily unavailable",
    "now.title": "Now",
    "now.description": "I’m turning things I can do once into workflows that can be reused many times.",
    "now.one.title": "Building AI asset-management workflows",
    "now.one.body": "Turning rules, decisions, and collaboration across research, trading, and risk into reusable workflows that agents can execute.",
    "now.two.title": "Shipping personal-IP systems",
    "now.two.body": "Building the Digital Ethan system and a content knowledge base to scale personal IP and product storytelling.",
    "now.three.title": "Maintaining PM skills",
    "now.three.body": "Turning requirements analysis, competitive research, PRD writing, and critique into a reusable PM skill stack.",
    "now.four.title": "Building with agents",
    "now.four.body": "Using AI coding tools to build products such as Novelty Studio and connect product design with implementation.",
    "now.jul1": "Jul 1",
    "now.jun14": "Jun 14",
    "daily.title": "Daily",
    "daily.ship": "Ship small",
    "daily.document": "Document well",
    "daily.help": "Help others",
    "contact.title": "Let’s build useful things together.",
    "contact.body": "I’m open to collaborating on fintech products, AI agent workflows, personal-IP systems, and product tools that turn messy judgment into repeatable systems.",
    "contact.email": "Email",
    "contact.github": "GitHub",
    "contact.location": "Location",
    "contact.locationValue": "Shanghai, China",
    "footer.designCredit": "Interaction reference: ",
    "footer.backTop": "Back to top ↑",
    "dialog.kicker": "// say hi",
    "dialog.title": "WeChat",
    "dialog.alt": "Ethan's WeChat QR code",
    "dialog.note": "Scan to add me and mention “personal site.”",
    "blog.hero.kicker": "FIELD NOTES · ETHAN SMC",
    "blog.legendAria": "Writing legend",
    "blog.essayLegend": "Essay · Developed judgment",
    "blog.noteLegend": "Note · A moment in progress",
    "blog.filterAria": "Filter writing by tag",
    "blog.all": "All",
    "blog.timelineAria": "Writing timeline",
    "blog.essay": "Essay",
    "blog.note": "Note",
    "blog.readMinutes": "{count} min read",
    "blog.tagsAria": "Tags",
    "blog.pagesAria": "Writing pages",
    "blog.newer": "← Newer writing",
    "blog.older": "Older writing →",
    "blog.emptyTitle": "The first piece is still on paper.",
    "blog.emptyBody": "Published writing will appear on this timeline automatically.",
    "blog.post.originalNotice": "This essay is presented in its original Chinese. The site interface is now in English.",
    "blog.post.navigationAria": "Adjacent writing",
    "blog.post.previous": "Previous",
    "blog.post.next": "Next",
    "blog.post.back": "Back to Writing",
    "blog.tag.kicker": "FIELD INDEX",
    "blog.tag.back": "← All writing",
    "blog.tag.count": "{count} entries, newest first.",
    "blog.footer.motto": "I write down judgments as they form and keep room for questions without answers.",
    "error.metaTitle": "Page not found | EthanSMC",
    "error.heading": "This page has not been written yet.",
    "error.body": "The address may have changed, or the content may not be published yet.",
    "error.back": "Return home",
  },
};

const authoredContent = {
  zh: {},
  ja: {
    "我为什么要给自己造一个 AI 原生的个人内容中心": "なぜ私は自分のためにAIネイティブな個人コンテンツハブを作るのか",
    "一开始，我其实没想过要做一个“AI 原生的个人内容中心”。": "最初から「AIネイティブな個人コンテンツハブ」を作ろうと思っていたわけではありません。",
    "个人内容中心": "個人コンテンツハブ",
    "AI知识库": "AIナレッジベース",
    "产品": "プロダクト",
    "独立开发": "個人開発",
  },
  en: {
    "我为什么要给自己造一个 AI 原生的个人内容中心": "Why I’m building an AI-native personal content hub",
    "一开始，我其实没想过要做一个“AI 原生的个人内容中心”。": "At first, I never intended to build an “AI-native personal content hub.”",
    "个人内容中心": "Personal content hub",
    "AI知识库": "AI knowledge base",
    "产品": "Product",
    "独立开发": "Indie development",
  },
};

const normalizeLocale = (value) => {
  if (!value) return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "zh" || normalized.startsWith("zh-")) return "zh";
  if (normalized === "ja" || normalized.startsWith("ja-")) return "ja";
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  return null;
};

const safeStorageGet = (storage, key) => {
  try {
    return storage?.getItem(key) || null;
  } catch {
    return null;
  }
};

const safeStorageSet = (storage, key, value) => {
  try {
    storage?.setItem(key, value);
  } catch {
    // Storage may be disabled; the current page can still switch languages.
  }
};

const params = new URLSearchParams(window.location.search);
const queryLocale = normalizeLocale(params.get("lang"));
const savedLocale = normalizeLocale(safeStorageGet(window.localStorage, EXPLICIT_LOCALE_KEY));
const browserLocale = [...(navigator.languages || []), navigator.language]
  .map(normalizeLocale)
  .find(Boolean) || null;
const cachedIpLocale = normalizeLocale(safeStorageGet(window.sessionStorage, IP_LOCALE_KEY));
const hasExplicitPreference = Boolean(queryLocale || savedLocale);
// Priority: explicit choice → browser language → cached IP inference → English.
let currentLocale = queryLocale || savedLocale || browserLocale || cachedIpLocale || "en";
const listeners = new Set();

const interpolate = (template, values = {}) => String(template).replace(
  /\{([a-zA-Z0-9_]+)\}/g,
  (_, key) => values[key] ?? `{${key}}`,
);

const t = (key, values = {}) => {
  const template = messages[currentLocale]?.[key] ?? messages.en[key] ?? key;
  return interpolate(template, values);
};

const translateAuthored = (source) => authoredContent[currentLocale]?.[source] || source;

const updateMetadata = () => {
  const titleKey = document.body?.dataset.i18nTitle;
  if (titleKey) document.title = t(titleKey);

  const descriptionKey = document.body?.dataset.i18nDescription;
  const description = descriptionKey ? t(descriptionKey) : null;
  if (description) {
    document.querySelector('meta[name="description"]')?.setAttribute("content", description);
    document.querySelector('meta[property="og:description"]')?.setAttribute("content", description);
    document.querySelector('meta[name="twitter:description"]')?.setAttribute("content", description);
  }

  document.querySelector('meta[property="og:title"]')?.setAttribute("content", document.title);
  document.querySelector('meta[name="twitter:title"]')?.setAttribute("content", document.title);
  document.querySelector('meta[property="og:locale"]')?.setAttribute(
    "content",
    { zh: "zh_CN", ja: "ja_JP", en: "en_US" }[currentLocale],
  );

  const postTitle = document.querySelector(".post-heading h1");
  if (postTitle) {
    const titleSeparator = currentLocale === "en" ? " | " : "｜";
    document.title = `${postTitle.textContent.trim()}${titleSeparator}${t("meta.writingBy")}`;
    document.querySelector('meta[property="og:title"]')?.setAttribute("content", document.title);
    document.querySelector('meta[name="twitter:title"]')?.setAttribute("content", document.title);
    const deck = document.querySelector(".post-deck");
    if (deck) {
      document.querySelector('meta[name="description"]')?.setAttribute("content", deck.textContent.trim());
      document.querySelector('meta[property="og:description"]')?.setAttribute("content", deck.textContent.trim());
      document.querySelector('meta[name="twitter:description"]')?.setAttribute("content", deck.textContent.trim());
    }
  }
};

const applyDocument = () => {
  document.documentElement.lang = HTML_LANGS[currentLocale];
  document.documentElement.dataset.locale = currentLocale;

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });

  const attributeBindings = [
    ["data-i18n-aria-label", "aria-label"],
    ["data-i18n-alt", "alt"],
    ["data-i18n-content", "content"],
    ["data-i18n-title-attr", "title"],
  ];
  attributeBindings.forEach(([dataAttribute, attribute]) => {
    document.querySelectorAll(`[${dataAttribute}]`).forEach((element) => {
      element.setAttribute(attribute, t(element.getAttribute(dataAttribute)));
    });
  });

  document.querySelectorAll("[data-i18n-authored]").forEach((element) => {
    const source = element.dataset.i18nAuthored || element.dataset.i18nAuthoredSource || element.textContent.trim();
    element.dataset.i18nAuthoredSource = source;
    element.textContent = translateAuthored(source);
  });

  document.querySelectorAll("[data-reading-minutes]").forEach((element) => {
    element.textContent = t("blog.readMinutes", { count: element.dataset.readingMinutes });
  });

  document.querySelectorAll("[data-tag-count]").forEach((element) => {
    element.textContent = t("blog.tag.count", { count: element.dataset.tagCount });
  });

  document.querySelectorAll("[data-locale-option]").forEach((button) => {
    const selected = button.dataset.localeOption === currentLocale;
    button.setAttribute("aria-pressed", String(selected));
    button.toggleAttribute("disabled", selected);
  });

  document.querySelectorAll("[data-original-language-note]").forEach((note) => {
    note.hidden = currentLocale === "zh";
  });

  updateMetadata();
};

const setLocale = (locale, { persist = false, updateUrl = false, source = "runtime" } = {}) => {
  const normalized = normalizeLocale(locale);
  if (!normalized || !SUPPORTED_LOCALES.includes(normalized)) return false;
  currentLocale = normalized;

  if (persist) {
    safeStorageSet(window.localStorage, EXPLICIT_LOCALE_KEY, normalized);
  }
  if (source === "ip") {
    safeStorageSet(window.sessionStorage, IP_LOCALE_KEY, normalized);
  }

  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set("lang", normalized);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }

  applyDocument();
  listeners.forEach((listener) => listener(normalized, source));
  window.dispatchEvent(new CustomEvent("site:localechange", {
    detail: { locale: normalized, source },
  }));
  return true;
};

const localeApiEndpoint = location.protocol === "file:" || location.hostname === "ethansmc.github.io"
  ? "https://ethansmc-personal-page.vercel.app/api/locale"
  : "/api/locale";

window.siteI18n = Object.freeze({
  getLocale: () => currentLocale,
  setLocale,
  t,
  translateAuthored,
  onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
});

document.querySelectorAll("[data-locale-option]").forEach((button) => {
  button.addEventListener("click", () => {
    setLocale(button.dataset.localeOption, {
      persist: true,
      updateUrl: true,
      source: "user",
    });
  });
});

applyDocument();

if (queryLocale) {
  safeStorageSet(window.localStorage, EXPLICIT_LOCALE_KEY, queryLocale);
}

if (!hasExplicitPreference && !browserLocale && !cachedIpLocale) {
  fetch(localeApiEndpoint, { headers: { Accept: "application/json" } })
    .then((response) => {
      if (!response.ok) throw new Error("Locale request failed");
      return response.json();
    })
    .then((payload) => {
      const locale = normalizeLocale(payload?.locale);
      if (locale) setLocale(locale, { source: "ip" });
    })
    .catch(() => {
      // English fallback is already active.
    });
}
