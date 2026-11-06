import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import OnboardingSkillsStep, { type OnboardingSkillsStepProps } from '../OnboardingSkillsStep';
import enCommon from '../../../i18n/locales/en/common.json';
import zhCommon from '../../../i18n/locales/zh-CN/common.json';
import koCommon from '../../../i18n/locales/ko/common.json';

const i18n = i18next.createInstance();
await i18n.init({
  lng: 'en',
  fallbackLng: false,
  ns: ['common'],
  defaultNS: 'common',
  resources: { en: { common: enCommon }, 'zh-CN': { common: zhCommon }, ko: { common: koCommon } },
  interpolation: { escapeValue: false },
});

function render(props: Partial<OnboardingSkillsStepProps> = {}): string {
  const full: OnboardingSkillsStepProps = {
    counts: { recommended: 19, all: 121, none: 0 },
    loading: false,
    loadFailed: false,
    selected: 'recommended',
    onSelect: () => {},
    ...props,
  };
  return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(OnboardingSkillsStep, full)));
}

function optionMarkup(html: string, baseline: string): string {
  const marker = html.indexOf(`data-baseline="${baseline}"`);
  expect(marker).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<button', marker);
  const end = html.indexOf('</button>', start);
  return html.slice(start, end);
}

describe('OnboardingSkillsStep', () => {
  it('shows the three starting sets with their skill counts', () => {
    const html = render();
    expect(optionMarkup(html, 'recommended')).toContain('19 skills enabled');
    expect(optionMarkup(html, 'all')).toContain('121 skills enabled');
    expect(optionMarkup(html, 'none')).toContain('0 skills enabled');
    expect(optionMarkup(html, 'recommended')).toContain(enCommon.skillDefaults.onboardingHint_recommended);
  });

  it('marks the selected starting set', () => {
    const html = render({ selected: 'all' });
    expect(optionMarkup(html, 'all')).toContain('aria-checked="true"');
    expect(optionMarkup(html, 'recommended')).toContain('aria-checked="false"');
    expect(optionMarkup(html, 'none')).toContain('aria-checked="false"');
  });

  it('hides counts while loading and warns when loading failed', () => {
    expect(render({ counts: null, loading: true })).not.toContain('skills enabled');
    const failed = render({ counts: null, loadFailed: true });
    expect(failed).not.toContain('skills enabled');
    expect(failed).toContain(enCommon.skillDefaults.loadFailed);
  });

  it('has every onboarding string in zh-CN and ko', () => {
    const keys = Object.keys(enCommon.skillDefaults).filter((key) => key.startsWith('onboarding'));
    for (const locale of [zhCommon, koCommon]) {
      for (const key of keys) {
        const lookup = key === 'onboardingCount_one' ? 'onboardingCount_other' : key;
        expect(locale.skillDefaults, key).toHaveProperty(lookup);
      }
    }
  });
});
