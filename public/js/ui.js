/* Shared presentation behavior. Existing page scripts own all data and actions. */
document.addEventListener('DOMContentLoaded', () => {
  // Associate legacy labels with their controls without changing event bindings.
  document.querySelectorAll('label:not([for])').forEach(label => {
    const control = label.parentElement.querySelector('input, select, textarea');
    if (control?.id) label.htmlFor = control.id;
  });
  let activeDialog = null;
  let returnFocus = null;
  const backdrops = [...document.querySelectorAll('.modal-backdrop')];
  backdrops.forEach(backdrop => {
    const modal = backdrop.querySelector('.modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const heading = modal.querySelector('h2');
    if (heading) {
      heading.id ||= `${backdrop.id}Heading`;
      modal.setAttribute('aria-labelledby', heading.id);
    }
  });
  function syncDialogs() {
    const open = backdrops.find(el => !el.classList.contains('hidden')) || null;
    if (open === activeDialog) return;
    if (open) {
      returnFocus = document.activeElement;
      activeDialog = open;
      [...document.body.children].forEach(el => {
        if (el !== open && !['SCRIPT', 'STYLE'].includes(el.tagName)) el.inert = true;
      });
      document.body.style.overflow = 'hidden';
      open.querySelector('input, select, textarea, button')?.focus();
    } else {
      activeDialog = null;
      [...document.body.children].forEach(el => { el.inert = false; });
      document.body.style.overflow = '';
      if (returnFocus?.isConnected) returnFocus.focus();
    }
  }
  const observer = new MutationObserver(syncDialogs);
  backdrops.forEach(el => observer.observe(el, { attributes: true, attributeFilter: ['class'] }));
  document.addEventListener('keydown', event => {
    if (!activeDialog) return;
    if (event.key === 'Escape') {
      const cancel = activeDialog.querySelector('[id*="Cancel"], [id*="cancel"], #closeTokenBtn, #cancelScanBtn');
      cancel?.click();
    }
    if (event.key !== 'Tab') return;
    const controls = [...activeDialog.querySelectorAll('button, input, select, textarea, a[href], [tabindex="0"]')]
      .filter(el => !el.disabled && el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (!first) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  const tabs = [...document.querySelectorAll('.tab')];
  if (tabs.length) {
    tabs[0].parentElement.setAttribute('role', 'tablist');
    tabs[0].parentElement.setAttribute('aria-label', 'Family dashboard');
    function syncTabs() {
      tabs.forEach(tab => {
        const selected = tab.classList.contains('active');
        tab.id ||= `tab-${tab.dataset.tab}`;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(selected));
        tab.setAttribute('aria-controls', `panel-${tab.dataset.tab}`);
        tab.tabIndex = selected ? 0 : -1;
        const panel = document.getElementById(`panel-${tab.dataset.tab}`);
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', tab.id);
      });
    }
    const tabObserver = new MutationObserver(syncTabs);
    tabs.forEach(tab => {
      tabObserver.observe(tab, { attributes: true, attributeFilter: ['class'] });
      tab.addEventListener('keydown', event => {
        const i = tabs.indexOf(tab);
        const next = event.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(i + tabs.length - 1) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : null;
        if (next) { event.preventDefault(); next.click(); next.focus(); next.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      });
    });
    syncTabs();
  }
});
