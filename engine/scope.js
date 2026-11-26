// Scope of the site: the root's ancestors, their siblings and the siblings' descendants,
// spouses, branches and the rule for living people. Ancestors of a married-in person only count
// when they have children with a blood relative. The root's own descendants stay out.
// Port of familychronicle/scope.py (dicts -> Map, sets -> Set, tuples -> arrays).
(function (g) {
  'use strict';

  const COMMON = 'common';
  const OTHER = 'other';          // ancestor from ahnentafel 8 up who belongs to no branch
  const BRANCH_BOUNDARY = 8;      // ahnentafel < 8 (root, parents, grandparents) = common
  const LIVING_YEARS = 100;       // default for config `living_years`

  const repr = (v) => (typeof v === 'string' ? `'${v}'` : String(v));

  // `living_years` must be an integer >= 100: a lower value would publish living people.
  function checkLivingYears(years) {
    if (typeof years !== 'number' || !Number.isInteger(years) || years < LIVING_YEARS) {
      throw new RangeError(`living_years must be an integer >= ${LIVING_YEARS} (got ${repr(years)}); `
        + 'a lower value would weaken the protection of living people');
    }
    return years;
  }

  // No DEAT/BURI and (born less than `years` ago, or the birth year is unknown).
  function isLiving(p, today, years = LIVING_YEARS) {
    checkLivingYears(years);
    if (p.hasDeath) return false;
    const birth = p.birth;
    if (!birth || !birth.date || birth.date.year === null || birth.date.year === undefined) return true;
    // by year only, on purpose cautious: even the year exactly `years` ago still counts as living
    return today.getFullYear() - birth.date.year <= years;
  }

  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  function ahnentafelOf(tree, root) {
    const numbers = new Map([[root, 1]]);
    const queue = [root];
    while (queue.length) {
      const x = queue.shift();
      const n = numbers.get(x);
      const pf = tree.people.get(x).parentsFamily;
      const f = pf ? tree.families.get(pf) : null;
      if (!f) continue;
      for (const [pid, k] of [[f.husband, 2 * n], [f.wife, 2 * n + 1]]) {
        if (pid && tree.people.has(pid) && (!numbers.has(pid) || k < numbers.get(pid))) {
          numbers.set(pid, k);   // on pedigree collapse the lowest number wins
          queue.push(pid);
        }
      }
    }
    return numbers;
  }

  function determineScope(tree, config, today) {
    const root = config.root;
    const years = checkLivingYears('living_years' in config ? config.living_years : LIVING_YEARS);
    const ahnentafel = ahnentafelOf(tree, root);
    const byAhn = [...ahnentafel.keys()].sort((a, b) => ahnentafel.get(a) - ahnentafel.get(b));

    const siblingOf = new Map();
    for (const p of byAhn) {
      for (const s of tree.siblings(p)) if (!ahnentafel.has(s) && !siblingOf.has(s)) siblingOf.set(s, p);
    }
    // half-siblings: children of an ancestor from another union (siblings of their child in the line)
    const halfSiblings = new Set();
    const byNumber = new Map([...ahnentafel].map(([i, n]) => [n, i]));
    for (const p of byAhn) {
      const n = ahnentafel.get(p);
      const child = byNumber.get(Math.floor(n / 2));
      if (n < 2 || !child) continue;
      for (const fid of tree.people.get(p).families) {
        if (fid === tree.people.get(child).parentsFamily || !tree.families.has(fid)) continue;
        for (const s of tree.families.get(fid).children) {
          if (tree.people.has(s) && !ahnentafel.has(s) && !siblingOf.has(s)) {
            siblingOf.set(s, child);
            halfSiblings.add(s);
          }
        }
      }
    }
    const siblings = new Set(siblingOf.keys());

    // branches: branch roots and their ancestors; the order in the config decides
    // on pedigree collapse (an ancestor belongs to the first branch that includes them)
    const branchOf = new Map();
    for (const [p, n] of ahnentafel) branchOf.set(p, n < BRANCH_BOUNDARY ? COMMON : OTHER);
    const assigned = new Set();
    for (const b of config.branches || []) {
      const stack = (b.roots || []).filter((r) => ahnentafel.has(r));
      const seen = new Set();
      while (stack.length) {
        const x = stack.pop();
        if (seen.has(x)) continue;
        seen.add(x);
        if (!assigned.has(x) && ahnentafel.get(x) >= BRANCH_BOUNDARY) {
          branchOf.set(x, b.key);
          assigned.add(x);
        }
        stack.push(...tree.parents(x).filter((r) => ahnentafel.has(r)));
      }
    }
    for (const [s, p] of siblingOf) branchOf.set(s, branchOf.get(p));

    const excluded = new Set(config.exclude || []);
    const mapPeople = new Set([...ahnentafel.keys(), ...siblings].filter((x) => !halfSiblings.has(x) && !excluded.has(x)));

    // descendants of siblings (cousins, nephews...) in all generations; the root's children are not included
    const descendantOf = new Map();
    const parentInLine = new Map();
    const queue = [];
    for (const s of [...siblings].sort(cmp)) for (const d of tree.children(s)) queue.push([d, s, 1, s]);
    while (queue.length) {
      const [x, s, depth, parent] = queue.shift();
      if (ahnentafel.has(x) || siblings.has(x) || descendantOf.has(x)) continue;
      descendantOf.set(x, [s, depth]);
      parentInLine.set(x, parent);
      for (const d of tree.children(x)) queue.push([d, s, depth + 1, x]);
    }
    for (const [x, [s]] of descendantOf) branchOf.set(x, branchOf.get(siblingOf.get(s)));

    // spouses and partners of the root, ancestors (further marriages), siblings and their descendants
    const blood = new Set([...ahnentafel.keys(), ...siblings, ...descendantOf.keys()]);
    const spouseOf = new Map();
    const spouseFamilies = new Map();
    const BIG = 1e9;
    const bloodSorted = [...blood].sort((a, b) => (ahnentafel.has(a) ? ahnentafel.get(a) : BIG)
      - (ahnentafel.has(b) ? ahnentafel.get(b) : BIG) || cmp(a, b));
    for (const a of bloodSorted) {
      for (const fid of tree.people.get(a).families) {
        const f = tree.families.get(fid);
        if (!f) continue;
        for (const m of [f.husband, f.wife]) {
          if (m && m !== a && tree.people.has(m) && !blood.has(m) && !spouseOf.has(m)) {
            spouseOf.set(m, a);
            const types = new Set(f.events.map((e) => e.type));
            spouseFamilies.set(m, { divorce: types.has('DIV'), marriage: types.has('MARR') });
          }
        }
      }
    }

    // ancestors of a co-parent: a married-in person with children among the blood relatives
    const partnerAncestor = new Map();
    const spouseSorted = [...spouseOf].sort((x, y) => cmp(x[0], y[0]) || cmp(x[1], y[1]));
    for (const [m, a] of spouseSorted) {
      const shared = tree.people.get(m).families.some((fid) => {
        const f = tree.families.get(fid);
        return f && (f.husband === a || f.wife === a) && f.children.some((d) => blood.has(d));
      });
      if (!shared) continue;
      for (const [x, n] of ahnentafelOf(tree, m)) {
        if (n > 1 && !blood.has(x) && !spouseOf.has(x) && !partnerAncestor.has(x)) {
          partnerAncestor.set(x, [m, n]);
          branchOf.set(x, branchOf.has(a) ? branchOf.get(a) : '');
        }
      }
    }

    const people = new Set([...blood, ...spouseOf.keys(), ...partnerAncestor.keys()].filter((x) => !excluded.has(x)));
    const living = new Set([...people].filter((i) => isLiving(tree.people.get(i), today, years)));
    for (const i of config.living_extra || []) if (people.has(i)) living.add(i);
    for (const i of config.deceased_extra || []) living.delete(i);

    const only = (map, keep) => new Map([...map].filter(keep));
    return {
      root, ahnentafel, siblings, people, living, branchOf,
      sex: new Map([...people].map((i) => [i, tree.people.get(i).sex])),
      siblingOf,
      descendantOf: only(descendantOf, ([k]) => people.has(k)),
      parentInLine,
      spouseOf: only(spouseOf, ([k, v]) => people.has(k) && people.has(v)),
      spouseFamilies,
      mapPeople: mapPeople.size ? mapPeople : new Set(people),
      halfSiblings: new Set([...halfSiblings].filter((x) => people.has(x))),
      partnerAncestor: only(partnerAncestor, ([k]) => people.has(k)),
      excluded,
    };
  }

  const api = { COMMON, OTHER, BRANCH_BOUNDARY, LIVING_YEARS, checkLivingYears, isLiving, determineScope, ahnentafel: ahnentafelOf };
  if (typeof module !== 'undefined') module.exports = api;
  else (g.FCEngine = g.FCEngine || {}).scope = api;
})(typeof window !== 'undefined' ? window : globalThis);
