// Month-name tables shared by privacy (redaction patterns) and event formatting.
// The Czech tables are data, not identifiers: they are needed to recognise and redact dates
// written in Czech text, and to format dates in the `cs` locale.
(function (g) {
  'use strict';

  const CS_NOM = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec',
    'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
  const CS_GEN = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července',
    'srpna', 'září', 'října', 'listopadu', 'prosince'];
  const CS_OTHER = [['lednu', 'lednem'], ['únoru', 'únorem'], ['březnu', 'březnem'],
    ['dubnu', 'dubnem'], ['květnu', 'květnem'], ['červnu', 'červnem'],
    ['červenci', 'červencem'], ['srpnu', 'srpnem'], ['září'],
    ['říjnu', 'říjnem'], ['listopadu', 'listopadem'], ['prosinci', 'prosincem']];
  const EN_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const EN_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Every spelling of a month (1-12) that redaction must recognise: the built-in Czech and
  // English forms plus `extra` (12 lists of forms, from the `privacy.months` of other locales).
  function monthNames(month, extra) {
    const i = month - 1;
    const out = [CS_GEN[i], CS_NOM[i], ...CS_OTHER[i], EN_FULL[i], EN_SHORT[i], EN_SHORT[i].toUpperCase()];
    if (extra) out.push(...extra[i]);
    if (month === 9) out.push('Sept');
    return [...new Set(out)];
  }

  const api = { CS_NOM, CS_GEN, CS_OTHER, EN_FULL, EN_SHORT, monthNames };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).dates = api;
})(typeof window !== 'undefined' ? window : globalThis);
