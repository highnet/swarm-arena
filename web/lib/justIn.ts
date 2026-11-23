/** Shared by the banner (client) and the layout's before-paint script (server). */
export const JUST_IN_STORAGE_KEY = 'just-in-dismissed';

/**
 * Runs before paint (from <head>), like the sidebar's: a story the visitor dismissed, or one too
 * old to be news, never flashes. The state lives on <html> so CSS hides the banner.
 */
export const justInInitScript = (slug: string, published: string, windowMs: number) =>
  `try{if(localStorage.getItem('${JUST_IN_STORAGE_KEY}')===${JSON.stringify(slug)}||Date.now()-${Date.parse(published)}>${windowMs})document.documentElement.dataset.justIn='hidden'}catch(e){}`;
