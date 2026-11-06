const PROBE_CLASS = 'stash-downloader-theme-probe';
type RGB = [number, number, number];

function colorChannels(color: string): RGB | null {
  const hex = color.trim().match(/^#([\da-f]{3,8})$/i)?.[1];
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const expanded = hex.length <= 4
      ? hex.slice(0, 3).split('').map((channel) => channel + channel).join('')
      : hex.slice(0, 6);
    const channels = [0, 2, 4].map((index) => Number.parseInt(expanded.slice(index, index + 2), 16));
    return [channels[0]!, channels[1]!, channels[2]!];
  }
  const channels = /^rgba?\(/i.test(color)
    ? color.match(/[\d.]+/g)?.slice(0, 3).map(Number)
    : undefined;
  return channels?.length === 3 && channels.every(Number.isFinite)
    ? [channels[0]!, channels[1]!, channels[2]!]
    : null;
}

function alphaColor(color: string, alpha: number): string {
  const channels = colorChannels(color);
  if (!channels) return color;
  return `rgba(${Math.round(channels[0])}, ${Math.round(channels[1])}, ${Math.round(channels[2])}, ${alpha})`;
}

function needsLightIcon(color: string): boolean {
  const channels = colorChannels(color);
  if (!channels) return true;
  const [red, green, blue] = channels.map((channel) => channel / 255) as RGB;
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.5;
}

function isTransparent(color: string): boolean {
  return color === 'transparent' || /rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(color);
}

/** Sample Stash's rendered controls so themes need no plugin-specific token names. */
export function syncHostTheme(root: HTMLElement): void {
  const probe = document.createElement('div');
  probe.className = PROBE_CLASS;
  probe.setAttribute('aria-hidden', 'true');
  probe.innerHTML = `
    <div class="card">
      <div class="card-header">Header</div>
      <button class="btn btn-primary" type="button">Primary</button>
      <button class="btn btn-secondary" type="button">Secondary</button>
      <button class="btn btn-success" type="button">Success</button>
      <button class="btn btn-info" type="button">Info</button>
      <button class="btn btn-warning" type="button">Warning</button>
      <button class="btn btn-danger" type="button">Danger</button>
      <button class="btn btn-outline-primary" type="button">Outline</button>
      <span class="badge bg-success">Success badge</span>
      <span class="badge bg-info">Info badge</span>
      <span class="badge bg-warning">Warning badge</span>
      <span class="badge bg-danger">Danger badge</span>
      <input class="form-control" />
      <span class="text-muted">Muted</span>
      <span class="text-info">Info text</span>
      <span class="text-success">Success text</span>
      <span class="text-warning">Warning text</span>
      <span class="text-danger">Danger text</span>
      <a href="#">Link</a>
      <div class="alert alert-info">Info</div>
      <div class="alert alert-success">Success</div>
      <div class="alert alert-warning">Warning</div>
      <div class="alert alert-danger">Danger</div>
      <div class="dropdown-menu show">Menu</div>
    </div>`;
  probe.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;width:320px;z-index:-1;';
  const appRoot = document.getElementById('root') || document.body;
  appRoot.appendChild(probe);

  try {
    const card = probe.querySelector<HTMLElement>('.card')!;
    const header = probe.querySelector<HTMLElement>('.card-header')!;
    const primary = probe.querySelector<HTMLElement>('.btn-primary')!;
    const input = probe.querySelector<HTMLElement>('.form-control')!;
    const muted = probe.querySelector<HTMLElement>('.text-muted')!;
    const link = probe.querySelector<HTMLElement>('a')!;
    const menu = probe.querySelector<HTMLElement>('.dropdown-menu')!;
    const styles = {
      body: getComputedStyle(document.body),
      app: getComputedStyle(appRoot),
      html: getComputedStyle(document.documentElement),
      card: getComputedStyle(card),
      header: getComputedStyle(header),
      primary: getComputedStyle(primary),
      secondary: getComputedStyle(probe.querySelector<HTMLElement>('.btn-secondary')!),
      successButton: getComputedStyle(probe.querySelector<HTMLElement>('.btn-success')!),
      infoButton: getComputedStyle(probe.querySelector<HTMLElement>('.btn-info')!),
      warningButton: getComputedStyle(probe.querySelector<HTMLElement>('.btn-warning')!),
      dangerButton: getComputedStyle(probe.querySelector<HTMLElement>('.btn-danger')!),
      successBadge: getComputedStyle(probe.querySelector<HTMLElement>('.badge.bg-success')!),
      infoBadge: getComputedStyle(probe.querySelector<HTMLElement>('.badge.bg-info')!),
      warningBadge: getComputedStyle(probe.querySelector<HTMLElement>('.badge.bg-warning')!),
      dangerBadge: getComputedStyle(probe.querySelector<HTMLElement>('.badge.bg-danger')!),
      input: getComputedStyle(input),
      muted: getComputedStyle(muted),
      infoText: getComputedStyle(probe.querySelector<HTMLElement>('.text-info')!),
      successText: getComputedStyle(probe.querySelector<HTMLElement>('.text-success')!),
      warningText: getComputedStyle(probe.querySelector<HTMLElement>('.text-warning')!),
      dangerText: getComputedStyle(probe.querySelector<HTMLElement>('.text-danger')!),
      link: getComputedStyle(link),
      menu: getComputedStyle(menu),
      info: getComputedStyle(probe.querySelector<HTMLElement>('.alert-info')!),
      success: getComputedStyle(probe.querySelector<HTMLElement>('.alert-success')!),
      warning: getComputedStyle(probe.querySelector<HTMLElement>('.alert-warning')!),
      danger: getComputedStyle(probe.querySelector<HTMLElement>('.alert-danger')!),
    };

    const themeToken = (name: string, fallback: string): string =>
      styles.app.getPropertyValue(name).trim() ||
      styles.body.getPropertyValue(name).trim() ||
      styles.html.getPropertyValue(name).trim() ||
      fallback;
    const visible = (value: string, fallback: string): string =>
      value && !isTransparent(value) ? value : fallback;

    const bodySurface = visible(styles.body.backgroundColor, styles.html.backgroundColor);
    const surface = themeToken('--glass-bg', visible(styles.card.backgroundColor, bodySurface));
    const raised = themeToken('--mica-elevated', visible(styles.header.backgroundColor, surface));
    const inputSurface = themeToken('--mica-base', visible(styles.input.backgroundColor, surface));
    const border = themeToken('--glass-border', visible(styles.card.borderColor, alphaColor(styles.body.color, 0.18)));
    const text = themeToken('--text', visible(styles.card.color, styles.body.color));
    const mutedText = themeToken('--text-muted', visible(styles.muted.color, text));
    const accent = themeToken('--accent', visible(styles.primary.backgroundColor, '#0d6efd'));
    const accentRgb = visible(styles.primary.backgroundColor, accent);
    const accentText = themeToken('--accent-contrast', visible(styles.primary.color, '#fff'));
    const accentBright = themeToken('--accent-bright', visible(styles.link.color, accent));
    const shadow = themeToken('--shadow-lg', styles.card.boxShadow || 'none');

    const variables: Record<string, string> = {
      '--glass-bg': surface,
      '--glass-bg-strong': themeToken('--glass-bg-strong', visible(styles.menu.backgroundColor, raised)),
      '--mica-elevated': raised,
      '--mica-base': inputSurface,
      '--theme-base': inputSurface,
      '--theme-elevated': raised,
      '--glass-border': border,
      '--text': text,
      '--text-muted': mutedText,
      '--accent': accent,
      '--accent-contrast': accentText,
      '--accent-bright': accentBright,
      '--accent-light': themeToken('--accent-light', accentBright),
      '--accent-tint': themeToken('--accent-tint', alphaColor(accentRgb, 0.16)),
      '--shadow-lg': shadow,
      '--radius': themeToken('--radius', styles.card.borderRadius || '8px'),
      '--radius-sm': themeToken('--radius-sm', styles.input.borderRadius || '4px'),
      '--downloader-button-radius': styles.primary.borderRadius || styles.input.borderRadius || '4px',
      '--theme-font-stack': styles.card.fontFamily || styles.app.fontFamily || styles.body.fontFamily,
      '--glass-blur-md': themeToken('--glass-blur-md', 'none'),
      '--downloader-close-filter': needsLightIcon(visible(styles.card.color, styles.body.color)) ? 'invert(1) grayscale(100%) brightness(200%)' : 'none',
      '--downloader-info-bg': visible(styles.info.backgroundColor, alphaColor(accent, 0.14)),
      '--downloader-info-border': visible(styles.info.borderColor, alphaColor(accent, 0.3)),
      '--downloader-info-text': visible(styles.info.color, accentBright),
      '--downloader-success-bg': visible(styles.success.backgroundColor, alphaColor(styles.success.color, 0.14)),
      '--downloader-success-border': visible(styles.success.borderColor, alphaColor(styles.success.color, 0.3)),
      '--downloader-success-text': visible(styles.success.color, text),
      '--downloader-warning-bg': visible(styles.warning.backgroundColor, alphaColor(styles.warning.color, 0.14)),
      '--downloader-warning-border': visible(styles.warning.borderColor, alphaColor(styles.warning.color, 0.3)),
      '--downloader-warning-text': visible(styles.warning.color, text),
      '--downloader-danger-bg': visible(styles.danger.backgroundColor, alphaColor(styles.danger.color, 0.14)),
      '--downloader-danger-border': visible(styles.danger.borderColor, alphaColor(styles.danger.color, 0.3)),
      '--downloader-danger-text': visible(styles.danger.color, text),
      '--downloader-secondary-bg': styles.secondary.backgroundColor,
      '--downloader-secondary-border': styles.secondary.borderColor,
      '--downloader-secondary-text': styles.secondary.color,
      '--downloader-success-button-bg': styles.successButton.backgroundColor,
      '--downloader-success-button-border': styles.successButton.borderColor,
      '--downloader-success-button-text': styles.successButton.color,
      '--downloader-info-button-bg': styles.infoButton.backgroundColor,
      '--downloader-info-button-border': styles.infoButton.borderColor,
      '--downloader-info-button-text': styles.infoButton.color,
      '--downloader-warning-button-bg': styles.warningButton.backgroundColor,
      '--downloader-warning-button-border': styles.warningButton.borderColor,
      '--downloader-warning-button-text': styles.warningButton.color,
      '--downloader-danger-button-bg': styles.dangerButton.backgroundColor,
      '--downloader-danger-button-border': styles.dangerButton.borderColor,
      '--downloader-danger-button-text': styles.dangerButton.color,
      '--downloader-success-badge-bg': styles.successBadge.backgroundColor,
      '--downloader-success-badge-text': styles.successBadge.color,
      '--downloader-info-badge-bg': styles.infoBadge.backgroundColor,
      '--downloader-info-badge-text': styles.infoBadge.color,
      '--downloader-warning-badge-bg': styles.warningBadge.backgroundColor,
      '--downloader-warning-badge-text': styles.warningBadge.color,
      '--downloader-danger-badge-bg': styles.dangerBadge.backgroundColor,
      '--downloader-danger-badge-text': styles.dangerBadge.color,
      '--downloader-text-info': styles.infoText.color,
      '--downloader-text-success': styles.successText.color,
      '--downloader-text-warning': styles.warningText.color,
      '--downloader-text-danger': styles.dangerText.color,
    };

    Object.entries(variables).forEach(([name, value]) => {
      if (value) root.style.setProperty(name, value);
    });
  } finally {
    probe.remove();
  }
}

/** Keep the plugin synchronized when Stash changes theme classes or styles. */
export function observeHostTheme(root: HTMLElement): () => void {
  let frame = 0;
  const scheduleSync = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => syncHostTheme(root));
  };

  syncHostTheme(root);
  const observer = new MutationObserver(scheduleSync);
  const options = { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-accent'] };
  observer.observe(document.documentElement, options);
  observer.observe(document.body, options);
  const appRoot = document.getElementById('root');
  if (appRoot) observer.observe(appRoot, options);
  observer.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'href'] });

  const colorScheme = window.matchMedia('(prefers-color-scheme: light)');
  colorScheme.addEventListener?.('change', scheduleSync);

  return () => {
    observer.disconnect();
    colorScheme.removeEventListener?.('change', scheduleSync);
    cancelAnimationFrame(frame);
  };
}
