const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 250;

const toPositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const getPagination = (query = {}, options = {}) => {
  const defaultLimit = options.defaultLimit || DEFAULT_LIMIT;
  const maxLimit = options.maxLimit || MAX_LIMIT;
  const page = toPositiveInteger(query.page, DEFAULT_PAGE);
  const requestedLimit = toPositiveInteger(query.limit || query.take, defaultLimit);
  const limit = Math.min(requestedLimit, maxLimit);
  const offset = query.offset !== undefined ? toPositiveInteger(query.offset, 0) : (page - 1) * limit;

  return {
    page,
    limit,
    offset,
    take: limit,
    skip: offset,
  };
};

export const getPaginationMeta = ({ total, page, limit, offset }) => ({
  total,
  page,
  limit,
  offset,
  page_count: limit > 0 ? Math.ceil(total / limit) : 0,
  has_more: offset + limit < total,
});
