const defaults = {};
export const meta = { name: 'blurb', summary: 'A short quoted passage.', shape: '{ text: string }',
                      category: 'text-and-code', defaults: { ...defaults } };
export function build({ id, title, data }) {
  var text = data && typeof data.text === 'string' ? data.text : '';
  return { html: '<section data-card="' + id + '"><h2>' + String(title) + '</h2><pre>' + text + '</pre></section>', css: '', js: '', json: {} };
}
