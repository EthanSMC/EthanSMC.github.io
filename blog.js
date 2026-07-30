const wechatDialog = document.querySelector("#wechat-dialog");
const siteI18n = window.siteI18n;
const translate = (key) => siteI18n?.t(key) || key;
const wechatOpen = document.querySelector("[data-wechat-open]");
const wechatClose = document.querySelector("[data-wechat-close]");

const closeWechatDialog = () => {
  if (typeof wechatDialog?.close === "function") wechatDialog.close();
  else wechatDialog?.removeAttribute("open");
};

wechatOpen?.addEventListener("click", () => {
  if (typeof wechatDialog?.showModal === "function") wechatDialog.showModal();
  else wechatDialog?.setAttribute("open", "");
});
wechatClose?.addEventListener("click", closeWechatDialog);
wechatDialog?.addEventListener("click", (event) => {
  if (event.target === wechatDialog) closeWechatDialog();
});

const soundToggle = document.querySelector(".sound-toggle");
let audioContext;

const updateSoundLabel = () => {
  if (!soundToggle) return;
  const enabled = soundToggle.getAttribute("aria-pressed") === "true";
  const key = enabled ? "common.disableSounds" : "common.enableSounds";
  soundToggle.dataset.i18nAriaLabel = key;
  soundToggle.setAttribute("aria-label", translate(key));
};

siteI18n?.onChange(updateSoundLabel);
updateSoundLabel();
const playUiTone = (frequency = 420, duration = 0.045, volume = 0.018) => {
  if (soundToggle?.getAttribute("aria-pressed") !== "true") return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  audioContext ??= new AudioContext();
  if (audioContext.state === "suspended") audioContext.resume();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + duration);
};

soundToggle?.addEventListener("click", () => {
  const enabled = soundToggle.getAttribute("aria-pressed") === "true";
  if (enabled) playUiTone(280, 0.055, 0.018);
  soundToggle.setAttribute("aria-pressed", String(!enabled));
  updateSoundLabel();
  if (!enabled) playUiTone(520, 0.07, 0.024);
});

document.querySelectorAll(".prose h2, .prose h3").forEach((heading) => {
  if (!heading.id) {
    const slug = heading.textContent.trim().toLocaleLowerCase("zh-CN")
      .replace(/\s+/g, "-")
      .replace(/[^\p{L}\p{N}_-]/gu, "");
    if (slug) heading.id = slug;
  }
});
