import { Suspense } from "react";
import ResetPasswordClient from "@/components/auth/reset-password/ResetPasswordClient";

export default function Page() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ResetPasswordClient />
    </Suspense>
  );
}