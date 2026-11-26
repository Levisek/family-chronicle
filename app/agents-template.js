// AGENTS.md for the folder of a family: what an AI assistant with access to the folder needs to
// know. Written once, at the first save; a person may change it afterwards.
(function (g) {
  'use strict';

  g.FCApp.agentsTemplate = `# This folder: a family chronicle

This folder belongs to Family Chronicle (https://github.com/Levisek/family-chronicle), an app that
turns a GEDCOM into a family website. Read this before you change anything here.

## What is here

- \`family.ged\`: the family tree, exported from a genealogy program. Do not edit it here; the
  person keeps it in their genealogy program and loads a newer export in the app.
- \`site.json\`: the settings (starting person, branches, languages, living people, exceptions).
- \`places.json\`: the coordinates of the places.
- \`chronicles/<branch>.md\`: the chronicles of the branches in Markdown; \`<branch>.<lang>.md\` is a
  translation. \`chronicles/.versions/\` holds earlier versions.
- \`documents.json\` and \`documents/\`: scans and photos of records, if there are any.
- \`web/\`: the website built by the app. Never edit it; it is replaced at every build.
- \`history/\`: copies of files from before they were overwritten. Leave it alone.

## Rules

- Living people: only their name, their relation and their town. No date of birth (not even the
  year), no address, no wedding date, no document or photo of a living person.
- Do not invent anything. Write as fact only what a record or the GEDCOM says; a conclusion gets
  "probably". Mark an unverified guess as such.
- In a chronicle keep the lines \`<!-- person: I12 -->\` and \`<!-- place: Vienna -->\` before the
  paragraph they belong to: they tie the text to the tree and the map.
- A mark like \`[Fill in: birthplace]\` is a gap the person still has to fill. Replace it only with
  something the records say; the website leaves the sentences with a mark out.
- After a change, open \`Family Chronicle.html\`, choose this folder and build the website again.
  The build checks that no date of a living person gets out and refuses to save otherwise.
`;
})(window);
