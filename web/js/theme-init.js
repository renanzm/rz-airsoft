/* Aplica o tema antes do primeiro desenho da página (evita piscar). */
(function () {
  var pref = "dark";
  try {
    pref = localStorage.getItem("rz3:theme") || "dark";
  } catch (error) {
    /* storage indisponível: fica o escuro */
  }
  var dark = pref === "dark" || (pref !== "light" && !(window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches));
  var root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.style.colorScheme = dark ? "dark" : "light";
  try {
    if (localStorage.getItem("rz3:sidebar") === "collapsed") root.dataset.sidebar = "collapsed";
  } catch (error) {
    /* idem */
  }
})();
