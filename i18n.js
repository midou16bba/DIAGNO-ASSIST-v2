window.I18N = window.I18N || {};

(function(){
  var currentLang = localStorage.getItem('diagLang') || 'ar';

  window.t = function(key) {
    return (window.I18N[currentLang] && window.I18N[currentLang][key]) || key;
  };

  window.getLang = function() {
    return currentLang;
  };

  window.setLanguage = function(lang) {
    currentLang = lang;
    localStorage.setItem('diagLang', lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    applyTranslations();
    document.querySelectorAll('.lang-option').forEach(function(el) {
      el.classList.toggle('active', el.getAttribute('data-lang') === lang);
    });
    var toast = document.getElementById('i18n-toast');
    if (toast) {
      toast.textContent = t('toast_lang_changed');
      toast.classList.add('show');
      setTimeout(function() { toast.classList.remove('show'); }, 2500);
    }
  };

  function applyTranslations() {
    var dict = window.I18N[currentLang] || {};
    document.querySelectorAll('[data-i18n]').forEach(function(el) {
      var key = el.getAttribute('data-i18n');
      if (dict[key]) el.textContent = dict[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-placeholder');
      if (dict[key]) el.placeholder = dict[key];
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function(el) {
      var key = el.getAttribute('data-i18n-html');
      if (dict[key]) el.innerHTML = dict[key];
    });
  }

  window.applyLanguage = function() {
    currentLang = localStorage.getItem('diagLang') || 'ar';
    document.documentElement.lang = currentLang;
    document.documentElement.dir = currentLang === 'ar' ? 'rtl' : 'ltr';
    applyTranslations();
    document.querySelectorAll('.lang-option').forEach(function(el) {
      el.classList.toggle('active', el.getAttribute('data-lang') === currentLang);
    });
  };

  document.addEventListener('DOMContentLoaded', function() {
    applyLanguage();
  });
})();
