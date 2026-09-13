export const themes = ['light', 'dark', 'sand', 'forest'];
export const normalizeTheme = value => themes.includes(value) ? value : 'light';
