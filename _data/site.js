module.exports = function () {
  const url = (process.env.SITE_URL || "https://ethansmc-personal-page.vercel.app").replace(/\/$/, "");
  return {
    name: "申名翀 Ethan",
    title: "申名翀 Ethan | Personal Site",
    description: "这里住着 Ethan 的手绘分身：白天做金融科技产品，晚上折腾 AI Agent，顺手记下那些还没有答案的问题。",
    language: "zh-CN",
    url,
    author: "申名翀 Ethan",
    email: "qq986399523@gmail.com"
  };
};
