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
      #root .card { background: rgb(240, 241, 242); color: rgb(25, 26, 27); border: 1px solid rgb(200, 201, 202); border-radius: 14px; box-shadow: 0 1px 4px rgb(0 0 0 / 20%); }
      #root .card-header { background: rgb(220, 221, 222); }
      #root .btn { font-family: Arial, sans-serif; font-size: 15px; font-weight: 600; line-height: 1.2; letter-spacing: 0.02em; text-transform: uppercase; padding: 0.7rem 1rem; border: 2px solid; box-shadow: 0 2px 4px rgb(0 0 0 / 20%); }
      #root .btn-sm { font-size: 13px; padding: 0.25rem 0.4rem; }
      #root .btn-primary { background: rgb(40, 80, 120); border-color: rgb(40, 80, 120); color: white; border-radius: 9px; }
      #root .btn-warning { background: rgb(220, 180, 30); border-color: rgb(220, 180, 30); color: black; }
      #root .form-control { background: rgb(250, 250, 250); border-radius: 6px; padding: 10px 12px; font-size: 14px; }
      #root .form-select { padding: 8px 32px 8px 12px; }
      #root .badge:not([class*="bg-"]) { font-size: 12px; font-weight: 700; padding: 0.5em 0.9em; border-radius: 12px; }
      #root .text-muted { color: rgb(110, 111, 112); }
      #root .text-warning { color: rgb(130, 90, 10); }
      #root .alert-success { background: rgb(230, 245, 235); border-color: rgb(90, 160, 110); color: rgb(35, 95, 50); }
      #root .alert-info { border-radius: 16px; }
      #root .dropdown-menu.show { border-radius: 18px; box-shadow: 0 4px 12px rgb(0 0 0 / 25%); backdrop-filter: blur(6px); }
      #root .modal-backdrop { background-color: rgb(10, 20, 30); opacity: 0.65; }
      #root .badge.bg-danger { background: rgb(180, 35, 50); color: white; }
    `;
    document.head.appendChild(theme);

    syncHostTheme(root);

    expect(root.style.getPropertyValue('--glass-bg')).toBe('rgb(240, 241, 242)');
    expect(root.style.getPropertyValue('--accent')).toBe('rgb(40, 80, 120)');
    expect(root.style.getPropertyValue('--theme-font-stack')).toContain('Arial');
    expect(root.style.getPropertyValue('--downloader-button-radius')).toBe('9px');
    expect(root.style.getPropertyValue('--downloader-button-font-weight')).toBe('600');
    expect(root.style.getPropertyValue('--downloader-button-padding')).toBe('11.2px 16px');
    expect(root.style.getPropertyValue('--downloader-compact-button-padding')).toBe('4px 6.4px');
    expect(root.style.getPropertyValue('--downloader-input-padding')).toBe('10px 12px');
    expect(root.style.getPropertyValue('--downloader-badge-radius')).toBe('12px');
    expect(root.style.getPropertyValue('--downloader-alert-radius')).toBe('16px');
    expect(root.style.getPropertyValue('--downloader-menu-radius')).toBe('18px');
    expect(root.style.getPropertyValue('--downloader-modal-backdrop-color')).toBe('rgba(10, 20, 30, 0.65)');
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
