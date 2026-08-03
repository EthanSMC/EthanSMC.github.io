module.exports = function () {
  const url = (process.env.SITE_URL || "https://ethansmc-personal-page.vercel.app").replace(/\/$/, "");
  return {
    name: "申名翀 Ethan",
    title: "是 Ethan，不是埃森｜碎碎念版",
    description: "这里没有标准答案。让思考发生，让讨论继续。",
    language: "zh-CN",
    url,
    author: "申名翀 Ethan",
    email: "qq986399523@gmail.com"
  };
};
