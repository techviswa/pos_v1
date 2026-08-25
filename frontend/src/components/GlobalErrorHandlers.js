import { useEffect } from "react";
import { toast } from "sonner";

import { getApiErrorDetails } from "../lib/apiErrors";

const isAxiosError = (error) => Boolean(error?.isAxiosError || error?.response || error?.config);

export const GlobalErrorHandlers = () => {
  useEffect(() => {
    const handleUnhandledRejection = (event) => {
      if (!isAxiosError(event.reason)) {
        return;
      }

      event.preventDefault();
      const details = getApiErrorDetails(event.reason);
      toast.error(details.title, {
        description: details.message,
      });
    };

    const handleWindowError = (event) => {
      if (!event.error) {
        return;
      }

      toast.error("Screen error", {
        description: "This part of the POS failed to render. Use Try Again on the screen.",
      });
    };

    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    window.addEventListener("error", handleWindowError);

    return () => {
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.removeEventListener("error", handleWindowError);
    };
  }, []);

  return null;
};
