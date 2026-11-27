import { pageMetadata } from "@/lib/metadata";

// app/auth/register/page.tsx
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RegisterForm } from "@/components/auth/register/RegisterForm";
import { checkPublicStoreAccess } from "@/lib/store-access/check-public-store-access";

export const metadata = pageMetadata(
  "Create an Account",
  "Create your Solesneakers account to manage your profile and keep track of your orders.",
);

export default async function RegisterPage() {
  const access = await checkPublicStoreAccess();
  if (!access.allowed) redirect("/locked");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/account");
  }

  return <RegisterForm />;
}
