// Face controller: turns a mood name into eye and eyelid positions,
// and keeps the face alive with blinking, glancing and gaze tracking.

const Face = (() => {
  const face = document.getElementById("face");
  const eyes = document.getElementById("eyes");
  const [eyeL, eyeR] = face.querySelectorAll(".eye");

  const BASE = { w: 1, h: 1, s: 1, top: 0, topRot: 0, bot: 0, botRot: 0, dx: 0, dy: 0 };


  // Each mood: left eye, optional right eye (mirrored by CSS), and a gaze nudge.
  const MOODS = {
    neutral:   { L: {} },
    listening: { L: { h: 1.08, s: 1.04 }, gaze: [0, 0.5] },
    happy:     { L: { bot: 0.5, h: 0.95 } },
    laugh:     { L: { bot: 0.62, h: 0.85, w: 1.1, top: 0.06 } },
    excited:   { L: { s: 1.15 } },
    love:      { L: {} },
    smug:      { L: { top: 0.48, topRot: -6, bot: 0.12 }, R: { top: 0.42, topRot: 4, bot: 0.12 }, gaze: [-0.7, 0] },
    wink:      { L: { bot: 0.5 }, R: { h: 0.12, top: 0, bot: 0, s: 1 } },
    surprised: { L: { h: 1.18, w: 1.08, s: 1.08 } },
    confused:  { L: { h: 0.78, top: 0.2, topRot: -10 }, R: { h: 1.12, s: 1.08 }, gaze: [0.3, -0.3] },
    thinking:  { L: { top: 0.22, topRot: 4, bot: 0.1 }, gaze: [0.8, -0.9] },
    sad:       { L: { top: 0.32, topRot: -16, h: 0.92, dy: 6 }, gaze: [0, 0.6] },
    annoyed:   { L: { top: 0.4, topRot: 16, bot: 0.12 } },
    sleepy:    { L: { top: 0.72, bot: 0.08, dy: 6 }, gaze: [0, 0.4] },
  };

  let mood = "neutral";
  let baseMood = "neutral";
  let holdTimer = null;
  let pointer = [0, 0];
  let talking = false;

  function applyEye(el, cfg) {
    const v = { ...BASE, ...cfg };
    const st = el.style;
    st.setProperty("--w", v.w);
    st.setProperty("--h", v.h);
    st.setProperty("--s", v.s);
    st.setProperty("--top", v.top);
    st.setProperty("--top-rot", v.topRot + "deg");
    st.setProperty("--bot", v.bot);
    st.setProperty("--bot-rot", v.botRot + "deg");
    st.setProperty("--dx", v.dx + "px");
    st.setProperty("--dy", v.dy + "px");
  }

  function updateGaze() {
    const g = MOODS[mood]?.gaze;
    // mood gaze wins, pointer adds a little life on top
    const x = g ? g[0] * 0.8 + pointer[0] * 0.2 : pointer[0];
    const y = g ? g[1] * 0.8 + pointer[1] * 0.2 : pointer[1];
    face.style.setProperty("--gx", (x * 16).toFixed(1) + "px");
    face.style.setProperty("--gy", (y * 11).toFixed(1) + "px");
  }

  function render(name) {
    const m = MOODS[name] || MOODS.neutral;
    mood = MOODS[name] ? name : "neutral";
    face.dataset.mood = mood;
    applyEye(eyeL, m.L);
    applyEye(eyeR, m.R || m.L);
    updateGaze();
  }

  // set(mood) changes expression now; with {hold} it falls back to the base mood afterwards.
  function set(name, { hold } = {}) {
    clearTimeout(holdTimer);
    render(name);
    if (hold) holdTimer = setTimeout(() => render(baseMood), hold);
  }

  function setBase(name) {
    baseMood = name;
    clearTimeout(holdTimer);
    render(name);
  }

  function look(x, y) {
    pointer = [Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y))];
    updateGaze();
  }

  function setTalking(on) {
    talking = on;
    face.classList.toggle("talking", on);
  }

  function blink() {
    if (["love", "excited", "sleepy", "wink"].includes(mood)) return;
    face.classList.add("blink");
    setTimeout(() => face.classList.remove("blink"), 110);
  }

  (function blinkLoop() {
    setTimeout(() => {
      blink();
      if (Math.random() < 0.2) setTimeout(blink, 220); // occasional double blink
      blinkLoop();
    }, 2200 + Math.random() * 3800);
  })();

  // small random glances when the pointer hasn't moved for a while
  let lastPointer = Date.now();
  document.addEventListener("pointermove", (e) => {
    lastPointer = Date.now();
    const r = eyes.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    look((e.clientX - cx) / (window.innerWidth / 2), (e.clientY - cy) / (window.innerHeight / 2));
  });
  setInterval(() => {
    if (Date.now() - lastPointer < 4000 || talking) return;
    if (Math.random() < 0.5) look((Math.random() * 2 - 1) * 0.6, (Math.random() * 2 - 1) * 0.4);
    else look(0, 0);
  }, 2600);

  render("neutral");
  return { set, setBase, look, setTalking, blink, get mood() { return mood; }, el: face };
})();
