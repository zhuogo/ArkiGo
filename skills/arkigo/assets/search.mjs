function searchText(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return Object.values(value).map(searchText).join(' ');
  return '';
}

const normalizeSearch = (value) => value.normalize('NFKC').toLowerCase();

export function buildSearchIndex(index, evidence = {}) {
  return [...index.objects.values()].map((object) => {
    const path = index.pathTo(object.id).map(({ id, title }) => ({ id, title }));
    const fields = [object.id, object.title, object.summary, searchText([
      object.body, object.notes, object.sources, object.implementation, object.verification,
      Object.hasOwn(evidence, object.id) ? evidence[object.id] : []
    ])].map(normalizeSearch);
    return { object, path, fields };
  });
}

export function searchDesign(entries, query) {
  const term = normalizeSearch(query.trim());
  if (!term) return [];
  const words = term.split(/\s+/);
  return entries.flatMap(({ object, path, fields }) => {
    const position = fields.findIndex((field) => field.includes(term));
    if (position < 0 && !words.every((word) => fields.some((field) => field.includes(word)))) return [];
    const exact = fields.slice(0, 2).includes(term);
    return [{ object, path, rank: exact ? -1 : position < 0 ? fields.length : position }];
  }).sort((a, b) => a.rank - b.rank || (a.object.id < b.object.id ? -1 : Number(a.object.id > b.object.id)));
}
