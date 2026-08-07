// ResearchFlow domain errors.
// Follows the existing server error style: message + HTTP status, JSON-serializable.

export class RfError extends Error {
  constructor(message, status = 400, code = 'RF_ERROR') {
    super(message);
    this.name = 'RfError';
    this.status = status;
    this.code = code;
  }
}

export class RfNotFoundError extends RfError {
  constructor(message = 'Not found') {
    super(message, 404, 'RF_NOT_FOUND');
  }
}

export class RfConflictError extends RfError {
  constructor(message = 'Conflict') {
    super(message, 409, 'RF_CONFLICT');
  }
}

export class RfValidationError extends RfError {
  constructor(message, details = undefined) {
    super(message, 400, 'RF_VALIDATION');
    this.details = details;
  }
}
