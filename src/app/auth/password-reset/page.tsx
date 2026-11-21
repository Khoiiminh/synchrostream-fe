import { Suspense } from "react";
import { ResetPasswordClient } from "@/features/auth/routes";

export default function Page() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <ResetPasswordClient />
        </Suspense>
    );
}
