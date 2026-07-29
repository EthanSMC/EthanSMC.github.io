module.exports = function () {
  const url = (process.env.SITE_URL || "https://ethansmc-personal-page.vercel.app").replace(/\/$/, "");
  return {
    name: "申名翀 Ethan",
    title: "申名翀 Ethan | Personal Site",
    description: "申名翀 Ethan 的手绘交互式个人网站：金融科技产品、AI Agent 工作流与持续写作。",
    language: "zh-CN",
    url,
    author: "申名翀 Ethan",
    email: "qq986399523@gmail.com"
  };
};
