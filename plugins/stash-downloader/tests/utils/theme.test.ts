import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { syncHostTheme } from '@/utils/theme';

describe('host theme integration', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"><div class="stash-downloader-plugin"></div></div>';
    root = document.querySelector<HTMLElement>('.stash-downloader-plugin')!;
  });

  afterEach(() => {
    document.head.querySelector('#theme-test-style')?.remove();
    document.body.innerHTML = '';
  });

  it('samples rendered controls when a theme has no plugin-specific variables', () => {
    const theme = document.createElement('style');
    theme.id = 'theme-test-style';
    theme.textContent = `
      #root { color: rgb(25, 26, 27); font-family: Arial, sans-serif; }
      #root .card { background: rgb(240, 241, 242); color: rgb(25, 26, 27); border: 1px solid rgb(200, 201, 202); border-radius: 14px; }
      #root .card-header { background: rgb(220, 221, 222); }
      #root .btn-primary { background: rgb(40, 80, 120); border-color: rgb(40, 80, 120); color: white; border-radius: 9px; }
      #root .btn-warning { background: rgb(220, 180, 30); border-color: rgb(220, 180, 30); color: black; }
      #root .form-control { background: rgb(250, 250, 250); border-radius: 6px; }
      #root .text-muted { color: rgb(110, 111, 112); }
      #root .text-warning { color: rgb(130, 90, 10); }
      #root .alert-success { background: rgb(230, 245, 235); border-color: rgb(90, 160, 110); color: rgb(35, 95, 50); }
      #root .badge.bg-danger { background: rgb(180, 35, 50); color: white; }
    `;
    document.head.appendChild(theme);

    syncHostTheme(root);

    expect(root.style.getPropertyValue('--glass-bg')).toBe('rgb(240, 241, 242)');
    expect(root.style.getPropertyValue('--accent')).toBe('rgb(40, 80, 120)');
    expect(root.style.getPropertyValue('--theme-font-stack')).toContain('Arial');
    expect(root.style.getPropertyValue('--downloader-button-radius')).toBe('9px');
    expect(root.style.getPropertyValue('--downloader-warning-button-bg')).toBe('rgb(220, 180, 30)');
    expect(root.style.getPropertyValue('--downloader-danger-badge-bg')).toBe('rgb(180, 35, 50)');
    expect(root.style.getPropertyValue('--downloader-success-bg')).toBe('rgb(230, 245, 235)');
    expect(root.style.getPropertyValue('--downloader-text-warning')).toBe('rgb(130, 90, 10)');
  });

  it('prefers host theme tokens when they are available', () => {
    const theme = document.createElement('style');
    theme.id = 'theme-test-style';
    theme.textContent = `
      #root { --glass-bg: #fafafa; --accent: #8a4fff; --text: #242424; --radius: 12px; }
      #root .card { background: rgb(10, 20, 30); }
      #root .btn-primary { background: rgb(10, 20, 30); }
    `;
    document.head.appendChild(theme);

    syncHostTheme(root);

    expect(root.style.getPropertyValue('--glass-bg')).toBe('#fafafa');
    expect(root.style.getPropertyValue('--accent')).toBe('#8a4fff');
    expect(root.style.getPropertyValue('--text')).toBe('#242424');
    expect(root.style.getPropertyValue('--radius')).toBe('12px');
  });
});
