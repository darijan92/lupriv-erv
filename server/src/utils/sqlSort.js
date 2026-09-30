function nullsLastOrder(nullCheck, expression = nullCheck, direction = 'ASC') {
  return `(${nullCheck} IS NULL OR TRIM(${nullCheck}) = '' OR TRIM(${nullCheck}) = '-') ASC, ${expression} ${direction}`;
}

/**
 * Numeric values first, sorted numerically, followed by non-numeric strings.
 * Nulls / empty / '-' always come last. `<direction>` applies to value order.
 */
function numericThenStringOrder(sourceExpr, direction = 'ASC') {
  const value = `TRIM(${sourceExpr})`;
  const emptyFlag = `(${sourceExpr} IS NULL OR ${value} = '' OR ${value} = '-')`;
  const numericFlag = `(${value} REGEXP '^[0-9]+$')`;
  return [
    `${emptyFlag} ASC`,
    `${numericFlag} DESC`,
    `CAST(${sourceExpr} AS UNSIGNED) ${direction}`,
    `${sourceExpr} ${direction}`,
  ].join(', ');
}

/**
 * Short OJ token sort: last whitespace-separated token of `sourceExpr`.
 * Nulls / empty / '-' always last. Among values: pure numeric tokens as numbers
 * first, then non-numeric strings. `<direction>` applies to value order only.
 */
function shortOjOrder(sourceExpr, direction = 'ASC') {
  const ojShort = `SUBSTRING_INDEX(TRIM(${sourceExpr}), ' ', -1)`;
  return numericThenStringOrder(ojShort, direction);
}

function buildOrderBy(fields, direction = 'ASC') {
  return fields
    .map((field) => {
      if (typeof field === 'string') return nullsLastOrder(field, field, direction);
      if (field.numericThenString)
        return numericThenStringOrder(field.numericThenString, direction);
      if (field.shortOj) return shortOjOrder(field.shortOj, direction);
      return nullsLastOrder(field.nullCheck || field.expression, field.expression, direction);
    })
    .join(', ');
}

/** Escape LIKE wildcards and wrap as a contains-pattern. */
function likePattern(q) {
  return `%${String(q).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
}

/** `?order=desc` → 'DESC', anything else → 'ASC'. */
function parseOrder(order) {
  return String(order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
}

module.exports = {
  nullsLastOrder,
  numericThenStringOrder,
  shortOjOrder,
  buildOrderBy,
  likePattern,
  parseOrder,
};
