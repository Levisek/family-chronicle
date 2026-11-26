// Relationship of a person to the root, in words (`cs` and `en`). The Czech grammar (genitive
// forms, the "pra-" prefix, cousin ordinals) is kept as data in the tables and inline forms below.
// Port of familychronicle/relationship.py.
(function (g) {
  'use strict';

  const CS = { M: ['otec', 'dědeček', 'pradědeček', 'prapradědeček'], F: ['matka', 'babička', 'prababička', 'praprababička'] };
  const CS_GEN = { M: ['otce', 'dědečka', 'pradědečka', 'prapradědečka'], F: ['matky', 'babičky', 'prababičky', 'praprababičky'] };
  const EN = { M: ['father', 'grandfather', 'great-grandfather'], F: ['mother', 'grandmother', 'great-grandmother'] };

  const generation = (n) => Math.floor(Math.log2(n));   // int.bit_length() - 1 for n >= 1

  function ancestor(gn, male, lang, gen = false) {
    const k = male ? 'M' : 'F';
    if (lang === 'cs') {
      const forms = (gen ? CS_GEN : CS)[k];
      if (gn <= 4) return forms[gn - 1];
      const base = gen ? (male ? 'pradědečka' : 'prababičky') : (male ? 'pradědeček' : 'prababička');
      return `${gn - 2}× ${base}`;
    }
    if (gn <= 3) return EN[k][gn - 1];
    return `${gn - 2}× ${EN[k][2]}`;
  }

  function bloodSibling(sl, cs, gen) {
    if (cs) return gen ? sl('bratra', 'sestry', 'sourozence') : sl('bratr', 'sestra', 'sourozenec');
    return sl('brother', 'sister', 'sibling');
  }

  // Blood relationship to the root (ancestor, ancestor's sibling, sibling's descendant).
  function blood(scope, id, lang, gen = false) {
    const cs = lang === 'cs';
    const p = scope.sex.get(id) || '';
    const male = p === 'M', female = p === 'F';
    const sl = (m, f, n) => (male ? m : female ? f : n);

    if (id === scope.root) return cs ? (gen ? 'autora' : 'sám autor') : 'the author';
    if (scope.ahnentafel.has(id)) {
      const n = scope.ahnentafel.get(id);
      return ancestor(generation(n), n % 2 === 0, lang, gen);
    }
    if (scope.siblingOf.has(id)) {
      const a = scope.siblingOf.get(id);
      if (a === scope.root) {
        if (scope.halfSiblings.has(id)) return (cs ? 'nevlastní ' : 'half-') + bloodSibling(sl, cs, gen);
        if (cs) return gen ? sl('bratra', 'sestry', 'sourozence') : sl('bratr', 'sestra', 'sourozenec');
        return sl('brother', 'sister', 'sibling');
      }
      const n = scope.ahnentafel.get(a);
      const half = scope.halfSiblings.has(id);
      if (cs) {
        let s = gen ? sl('bratra', 'sestry', 'sourozence') : sl('bratr', 'sestra', 'sourozenec');
        if (half) s = sl(gen ? 'nevlastního ' : 'nevlastní ', 'nevlastní ', gen ? 'nevlastního ' : 'nevlastní ') + s;
        return `${s} ${ancestor(generation(n), n % 2 === 0, 'cs', true)}`;
      }
      return `${half ? 'half-' : ''}${sl('brother', 'sister', 'sibling')} of ${ancestor(generation(n), n % 2 === 0, 'en')}`;
    }
    if (!scope.descendantOf.has(id)) return '';
    const [s, d] = scope.descendantOf.get(id);
    const a = scope.siblingOf.get(s);
    const n = scope.ahnentafel.get(a);
    const gn = generation(n);
    if (gn === 0) {
      if (cs) {
        const base = gen ? sl('synovce', 'neteře', 'potomka sourozence') : sl('synovec', 'neteř', 'potomek sourozence');
        if (d === 1) return base;
        const prefix = d <= 3 ? 'pra'.repeat(d - 1) : `${d - 1}× pra`;
        return male || female ? prefix + base : base;
      }
      const base = sl('nephew', 'niece', "sibling's descendant");
      return d === 1 ? base : (male || female ? 'great-'.repeat(Math.max(0, d - 2)) + 'grand' + base : base);
    }
    const k = Math.min(gn, d);   // degree of cousinship
    const r = gn - d;            // >0 older generation, <0 younger
    if (cs) {
      const ordinal = ['', '', 'druh', 'třet', 'čtvrt'];
      let maleForm, femaleForm;
      if (k === 1) {
        [maleForm, femaleForm] = gen ? ['bratrance', 'sestřenice'] : ['bratranec', 'sestřenice'];
      } else {
        const o = k < ordinal.length ? ordinal[k] : `${k}.`;
        if (k < ordinal.length) {
          maleForm = gen ? `${o}ého bratrance` : `${o}ý bratranec`;
          femaleForm = gen ? `${o}é sestřenice` : `${o}á sestřenice`;
        } else {
          [maleForm, femaleForm] = gen ? [`${o} bratrance`, `${o} sestřenice`] : [`${o} bratranec`, `${o} sestřenice`];
        }
      }
      if (r >= 0) {
        const base = sl(maleForm, femaleForm, maleForm);
        if (r === 0) return base;
        const m = n >> (gn - r);
        return `${base} ${ancestor(r, m % 2 === 0, 'cs', true)}`;
      }
      let parent = id;
      for (let i = 0; i < -r; i++) parent = scope.parentInLine.has(parent) ? scope.parentInLine.get(parent) : parent;
      const parentFemale = (scope.sex.get(parent) || '') === 'F';
      const kin = { 1: gen ? ['syna', 'dcery', 'dítěte'] : ['syn', 'dcera', 'dítě'], 2: gen ? ['vnuka', 'vnučky', 'vnoučete'] : ['vnuk', 'vnučka', 'vnouče'] };
      const triple = kin[-r] || (gen ? ['potomka', 'potomka', 'potomka'] : ['potomek', 'potomek', 'potomek']);
      let cousinGen;
      if (k === 1) cousinGen = parentFemale ? 'sestřenice' : 'bratrance';
      else if (k < ordinal.length) cousinGen = parentFemale ? `${ordinal[k]}é sestřenice` : `${ordinal[k]}ého bratrance`;
      else cousinGen = parentFemale ? `${k}. sestřenice` : `${k}. bratrance`;
      return `${sl(...triple)} ${cousinGen}`;
    }
    const ordinalEn = { 1: 'first', 2: 'second', 3: 'third' }[k] || `${k}th`;
    const base = `${ordinalEn} cousin`;
    if (r === 0) return base;
    if (r > 0) {
      const m = n >> (gn - r);
      return `${base} of ${ancestor(r, m % 2 === 0, 'en')}`;
    }
    let parent = id;
    for (let i = 0; i < -r; i++) parent = scope.parentInLine.has(parent) ? scope.parentInLine.get(parent) : parent;
    const kdo = { 1: ['son', 'daughter', 'child'], 2: ['grandson', 'granddaughter', 'grandchild'] }[-r] || ['descendant', 'descendant', 'descendant'];
    return `${sl(...kdo)} of ${base}`;
  }

  // Genitive form ("husband of grandmother" in Czech) for the ancestors of a married-in person.
  function spouseOfAncestor(scope, id, lang, gen) {
    const base = relationship(scope, id, lang);
    if (lang !== 'cs' || !gen) return base;
    for (const [nom, genitive] of [['bývalý manžel', 'bývalého manžela'], ['bývalá manželka', 'bývalé manželky'],
      ['manželka', 'manželky'], ['manžel', 'manžela'], ['přítelkyně', 'přítelkyně'], ['přítel', 'přítele']]) {
      if (base.startsWith(nom)) return genitive + base.slice(nom.length);
    }
    return base;
  }

  // Relationship of a person to the root of the tree.
  function relationship(scope, id, lang) {
    const cs = lang === 'cs';
    if (scope.partnerAncestor.has(id)) {
      const [m, n] = scope.partnerAncestor.get(id);
      return `${ancestor(generation(n), n % 2 === 0, lang)} ${cs ? '' : 'of the '}${spouseOfAncestor(scope, m, lang, cs)}`;
    }
    if (scope.spouseOf.has(id)) {
      const a = scope.spouseOf.get(id);
      const f = (scope.sex.get(id) || '') === 'F';
      const info = scope.spouseFamilies.get(id) || {};
      let word;
      if (cs) {
        if (!info.marriage && !info.divorce) word = f ? 'přítelkyně' : 'přítel';
        else {
          word = f ? 'manželka' : 'manžel';
          if (info.divorce) word = (f ? 'bývalá ' : 'bývalý ') + word;
        }
        return a === scope.root ? word : `${word} ${blood(scope, a, 'cs', true)}`;
      }
      if (!info.marriage && !info.divorce) word = 'partner';
      else {
        word = f ? 'wife' : 'husband';
        if (info.divorce) word = 'former ' + word;
      }
      return a === scope.root ? word : `${word} of ${blood(scope, a, 'en')}`;
    }
    return blood(scope, id, lang);
  }

  const api = { relationship };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).relationship = api;
})(typeof window !== 'undefined' ? window : globalThis);
