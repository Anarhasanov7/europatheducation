// ─── i18n.js — Language toggle for EuroPath Education ───
// Uses data-en attributes on elements to swap text between Russian and English

(function() {
  const STORAGE_KEY = 'edupath_lang';
  const DEFAULT_LANG = 'ru';

  function getCurrentLang() {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG;
  }

  function setLang(lang) {
    localStorage.setItem(STORAGE_KEY, lang);
    applyLang(lang);
    updateToggleButtons(lang);
  }

  function applyLang(lang) {
    // Swap text content for elements with data-en attribute
    const elements = document.querySelectorAll('[data-en]');
    elements.forEach(el => {
      if (lang === 'en') {
        if (el.dataset.enOriginal === undefined) {
          el.dataset.enOriginal = el.innerHTML;
        }
        el.innerHTML = el.dataset.en;
      } else {
        if (el.dataset.enOriginal !== undefined) {
          el.innerHTML = el.dataset.enOriginal;
        }
      }
    });

    // Swap placeholder text for inputs with data-en-placeholder
    const inputs = document.querySelectorAll('[data-en-placeholder]');
    inputs.forEach(el => {
      if (lang === 'en') {
        if (el.dataset.enPlaceholderOriginal === undefined) {
          el.dataset.enPlaceholderOriginal = el.placeholder;
        }
        el.placeholder = el.dataset.enPlaceholder;
      } else {
        if (el.dataset.enPlaceholderOriginal !== undefined) {
          el.placeholder = el.dataset.enPlaceholderOriginal;
        }
      }
    });

    // Update html lang attribute
    document.documentElement.lang = lang;

    // Dispatch event for page-specific JS
    window.dispatchEvent(new CustomEvent('langchange', { detail: { lang } }));
  }

  function updateToggleButtons(lang) {
    const ruBtn = document.getElementById('lang-ru');
    const enBtn = document.getElementById('lang-en');
    if (ruBtn && enBtn) {
      if (lang === 'ru') {
        ruBtn.classList.add('active');
        enBtn.classList.remove('active');
      } else {
        ruBtn.classList.remove('active');
        enBtn.classList.add('active');
      }
    }
  }

  function toggleLang() {
    const current = getCurrentLang();
    setLang(current === 'ru' ? 'en' : 'ru');
  }

  // Expose globally
  window.edupathI18n = { setLang, getCurrentLang, toggleLang, applyLang };

  // Apply on page load
  function init() {
    const lang = getCurrentLang();
    applyLang(lang);
    updateToggleButtons(lang);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
