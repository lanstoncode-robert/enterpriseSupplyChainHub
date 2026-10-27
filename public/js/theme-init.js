(() => {
  try {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('theme');
    if (requested === 'light' || requested === 'dark') {
      localStorage.setItem('sch.theme', requested);
    }
    const stored = localStorage.getItem('sch.theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = stored ? stored === 'dark' : prefersDark;
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch {
    /* Private browsing: fall back to the light theme. */
  }
})();
