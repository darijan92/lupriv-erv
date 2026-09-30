/**
 * Zod validation helper: validate({ body, query, params })
 */
function validate(schemas) {
  return (req, res, next) => {
    try {
      if (schemas.body) {
        const r = schemas.body.safeParse(req.body);
        if (!r.success) {
          return res.status(400).json({
            error: r.error.issues[0]?.message || 'Neispravni podaci',
            details: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          });
        }
        req.body = r.data;
      }
      if (schemas.query) {
        const r = schemas.query.safeParse(req.query);
        if (!r.success) {
          return res.status(400).json({
            error: r.error.issues[0]?.message || 'Neispravni query parametri',
          });
        }
        req.query = { ...req.query, ...r.data };
      }
      if (schemas.params) {
        const r = schemas.params.safeParse(req.params);
        if (!r.success) {
          return res.status(400).json({ error: r.error.issues[0]?.message || 'Neispravni parametri' });
        }
        req.params = { ...req.params, ...r.data };
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

module.exports = { validate };
