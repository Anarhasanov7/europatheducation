// ─── theme.js — Dark/Light mode toggle for EuroPath Education ───
(function() {
  const STORAGE_KEY = 'edupath_theme';
  const DEFAULT_THEME = 'light';

  function getCurrentTheme() {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME;
  }

  function setTheme(theme) {
    localStorage.setItem(STORAGE_KEY, theme);
    applyTheme(theme);
    updateToggleButton(theme);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }

  function updateToggleButton(theme) {
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.textContent = theme === 'dark' ? '☀️' : '🌙';
      btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    }
  }

  function toggleTheme() {
    const current = getCurrentTheme();
    setTheme(current === 'light' ? 'dark' : 'light');
  }

  window.edupathTheme = { setTheme, getCurrentTheme, toggleTheme };

  function init() {
    const theme = getCurrentTheme();
    applyTheme(theme);
    updateToggleButton(theme);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
