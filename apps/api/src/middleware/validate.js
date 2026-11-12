import { badRequest } from "../utils/AppError.js";
import { formatZodError } from "@coaching/shared";

/** Validate and replace request parts with parsed values. */
export function validate(schemas) {
  return (req, _res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query ?? {});
        // Express 5 exposes a getter-only req.query; keep values in res.locals style.
        req.validatedQuery = parsed;
        req.query = parsed;
      }
      if (schemas.params) {
        req.params = schemas.params.parse(req.params ?? {});
      }
      return next();
    } catch (error) {
      if (error?.issues) {
        const { message, details } = formatZodError(error);
        return next(badRequest(message, details));
      }
      return next(error);
    }
  };
}
