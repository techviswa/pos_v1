// Convert expected database conflicts into actionable responses without exposing SQL.
export const publicDatabaseError = (error) => {
  if (error?.code === "P2002") {
    const target = Array.isArray(error.meta?.target) ? error.meta.target.join(" ") : String(error.meta?.target || "");
    const email = /email/i.test(target);
    return {
      statusCode: 409,
      code: email ? "EMAIL_EXISTS" : "RECORD_ALREADY_EXISTS",
      message: email ? "A user with that email already exists in this business" : "A record with these details already exists",
    };
  }
  if (error?.code === "P2025") return { statusCode: 404, code: "RECORD_NOT_FOUND", message: "The requested record no longer exists" };
  return error;
};
