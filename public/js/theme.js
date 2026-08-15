(function () {
  const storageKey = 'piggyledger_theme';

  function storedTheme() {
    try {
      return localStorage.getItem(storageKey) === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;

    const toggle = document.getElementById('themeToggle');
    if (!toggle) return;

    const dark = theme === 'dark';
    toggle.setAttribute('aria-checked', String(dark));
    toggle.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    toggle.querySelector('.theme-toggle-icon').textContent = dark ? '☀' : '☾';
    toggle.querySelector('.theme-toggle-text').textContent = dark ? 'Light mode' : 'Dark mode';
  }

  applyTheme(storedTheme());

  document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.createElement('button');
    toggle.id = 'themeToggle';
    toggle.className = 'theme-toggle';
    toggle.type = 'button';
    toggle.setAttribute('role', 'switch');
    toggle.innerHTML = '<span class="theme-toggle-icon" aria-hidden="true"></span><span class="theme-toggle-text"></span>';
    toggle.addEventListener('click', () => {
      const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(storageKey, theme);
      } catch {
        // The theme still applies for this page when storage is unavailable.
      }
      applyTheme(theme);
    });
    document.body.appendChild(toggle);
    applyTheme(document.documentElement.dataset.theme || storedTheme());
  });
})();
