const validateCode = (code) => {
  if (!code || typeof code !== 'string') {
    return { valid: false, error: 'Code is required and must be a string' };
  }
  if (code.length > 100000) {
    return { valid: false, error: 'Code exceeds maximum length of 100000 characters' };
  }
  return { valid: true };
};

const validateLanguage = (language) => {
  const validLanguages = ['javascript', 'python', 'typescript', 'java', 'c', 'cpp'];
  if (!language || !validLanguages.includes(language.toLowerCase())) {
    return { valid: false, error: `Invalid language. Must be one of: ${validLanguages.join(', ')}` };
  }
  return { valid: true };
};

const validateJudgeInput = (data) => {
  const errors = [];

  if (data.energy === undefined || data.energy === null) {
    errors.push('energy is required');
  } else if (
    !Number.isInteger(data.energy) ||
    data.energy < 1 ||
    data.energy > 5
  ) {
    errors.push('energy must be an integer from 1 to 5');
  }

  if (!data.excuse || typeof data.excuse !== 'string' || data.excuse.trim().length === 0) {
    errors.push('excuse must be a non-empty string');
  } else if (data.excuse.length > 500) {
    errors.push('excuse must not exceed 500 characters');
  }

  if (data.platform !== undefined && typeof data.platform !== 'string') {
    errors.push('platform must be a string');
  }

  if (data.requestedMinutes !== undefined) {
    if (
      typeof data.requestedMinutes !== 'number' ||
      !Number.isInteger(data.requestedMinutes) ||
      data.requestedMinutes < 1 ||
      data.requestedMinutes > 60
    ) {
      errors.push('requestedMinutes must be an integer from 1 to 60');
    }
  }

  if (errors.length > 0) {
    return { valid: false, error: errors[0] };
  }
  return { valid: true };
};

module.exports = { validateCode, validateLanguage, validateJudgeInput };