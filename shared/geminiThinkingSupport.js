export const GEMINI_THINKING_MODE_IDS = [
  'default',
  'minimal',
  'low',
  'medium',
  'high',
  'dynamic',
  'off',
  'light',
  'balanced',
  'deep',
  'max',
];

function isGemini3Model(model) {
  return typeof model === 'string' && model.startsWith('gemini-3');
}

function isGemini25Model(model) {
  return typeof model === 'string' && model.startsWith('gemini-2.5');
}

function isGeminiProModel(model) {
  return typeof model === 'string' && /-pro(?:-|$)/.test(model);
}

export function getGeminiThinkingFamily(model) {
  if (isGemini3Model(model)) return 'gemini-3';
  if (isGemini25Model(model)) return 'gemini-2.5';
  return null;
}

export function getSupportedGeminiThinkingModes(model) {
  switch (model) {
    case 'gemini-3.1-pro-preview':
      return ['default', 'low', 'medium', 'high'];
    case 'gemini-3.5-flash':
    case 'gemini-3.1-flash-lite':
    case 'gemini-3.1-flash-lite-preview':
    case 'gemini-3-flash-preview':
      return ['default', 'minimal', 'low', 'medium', 'high'];
    case 'gemini-2.5-pro':
      return ['default', 'dynamic', 'light', 'balanced', 'deep', 'max'];
    case 'gemini-2.5-flash':
    case 'gemini-2.5-flash-lite':
      return ['default', 'dynamic', 'off', 'light', 'balanced', 'deep'];
    default: {
      // A model this table has not seen (the API list moves faster than we
      // do) still belongs to a family whose thinking controls are known:
      // Gemini 3 takes a thinking level, Gemini 2.5 a thinking budget.
      const family = getGeminiThinkingFamily(model);
      if (family === 'gemini-3') {
        return isGeminiProModel(model)
          ? ['default', 'low', 'medium', 'high']
          : ['default', 'minimal', 'low', 'medium', 'high'];
      }
      if (family === 'gemini-2.5') {
        return isGeminiProModel(model)
          ? ['default', 'dynamic', 'light', 'balanced', 'deep', 'max']
          : ['default', 'dynamic', 'off', 'light', 'balanced', 'deep'];
      }
      return ['default'];
    }
  }
}

export function supportsExplicitGeminiThinkingMode(model) {
  return getSupportedGeminiThinkingModes(model).length > 1;
}

export function buildGeminiThinkingConfig(model, mode) {
  if (!model || !mode || mode === 'default') {
    return null;
  }

  if (isGemini3Model(model)) {
    const levelMap = {
      minimal: 'MINIMAL',
      low: 'LOW',
      medium: 'MEDIUM',
      high: 'HIGH',
    };
    const thinkingLevel = levelMap[mode];
    return thinkingLevel ? { thinkingLevel } : null;
  }

  if (isGemini25Model(model)) {
    const budgetMapByModel = {
      'gemini-2.5-pro': {
        dynamic: -1,
        light: 1024,
        balanced: 8192,
        deep: 24576,
        max: 32768,
      },
      'gemini-2.5-flash': {
        dynamic: -1,
        off: 0,
        light: 1024,
        balanced: 8192,
        deep: 24576,
      },
      'gemini-2.5-flash-lite': {
        dynamic: -1,
        off: 0,
        light: 512,
        balanced: 8192,
        deep: 24576,
      },
    };

    // Unknown 2.5 models take the budgets of the closest known sibling.
    const budgets = budgetMapByModel[model]
      || (isGeminiProModel(model) ? budgetMapByModel['gemini-2.5-pro'] : budgetMapByModel['gemini-2.5-flash']);
    const budget = budgets?.[mode];
    return Number.isInteger(budget) ? { thinkingBudget: budget } : null;
  }

  return null;
}
