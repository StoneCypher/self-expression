const defaults = {};
export const meta = { name: 'tally', summary: 'A single number against a target.', shape: '{ value: number, target: number }',
                      category: 'ranking-and-comparison', defaults: { ...defaults } };
export function build({ id, title, data }) {
  var v = data && typeof data.value === 'number' ? data.value : 0;
  var t = data && typeof data.target === 'number' ? data.target : 0;
  return {
    html: '<section data-card="' + id + '"><h2>' + String(title) + '</h2><p>' + v + ' / ' + t + '</p></section>',
    css:  '',
    js:   'DESK.inits.push(function () {});',
    json: {},
  };
}
